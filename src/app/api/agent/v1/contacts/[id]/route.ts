import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import { isValidEmail } from "@/lib/agent-api/contact-defaults";
import {
  requireServiceAuth,
  subAccountAllowed,
} from "@/lib/auth/require-service-auth";
import { PIPELINE_STAGES } from "@/types/deals";
import { fireTagAddedTriggers } from "@/lib/automations/tag-triggers";

async function loadAuthorizedContact(
  request: Request,
  id: string,
  scope: "contacts:read" | "contacts:write"
) {
  const access = await requireServiceAuth(request, { scope });
  if (access instanceof NextResponse) return access;

  const ref = getAdminDb().doc(`contacts/${id}`);
  const snap = await ref.get();
  if (!snap.exists) return agentError("NOT_FOUND", "Contact not found.", 404);
  const contact = snap.data() as Record<string, unknown>;
  if (!subAccountAllowed(access, contact.subAccountId as string)) {
    // Doc-ID-resolved foreign tenant: 404, not 403 — don't reveal existence.
    return agentError("NOT_FOUND", "Contact not found.", 404);
  }
  return { access, ref, contact };
}

export const GET = withAgentRoute<{ params: Promise<{ id: string }> }>(
  async (request, ctx) => {
    const { id } = await ctx.params;
    const loaded = await loadAuthorizedContact(request, id, "contacts:read");
    if (loaded instanceof NextResponse) return loaded;
    const { contact } = loaded;
    return NextResponse.json({
      data: {
        id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        company: contact.company,
        tags: contact.tags,
        pipelineStage: contact.pipelineStage,
        emailOptedOut: contact.emailOptedOut,
        smsOptedOut: contact.smsOptedOut,
        subAccountId: contact.subAccountId,
      },
    });
  }
);

export const PATCH = withAgentRoute<{ params: Promise<{ id: string }> }>(
  async (request, ctx) => {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as {
      name?: string;
      company?: string;
      phone?: string;
      email?: string;
      pipelineStage?: string;
      addTags?: string[];
      removeTags?: string[];
    } | null;
    if (!body)
      return agentError("VALIDATION_FAILED", "Invalid JSON body.", 400);

    if (
      body.pipelineStage !== undefined &&
      !PIPELINE_STAGES.some((s) => s.id === body.pipelineStage)
    ) {
      return agentError(
        "VALIDATION_FAILED",
        `Unknown pipelineStage. Valid: ${PIPELINE_STAGES.map((s) => s.id).join(", ")}.`,
        400
      );
    }
    if (
      typeof body.email === "string" &&
      body.email !== "" &&
      !isValidEmail(body.email.trim().toLowerCase())
    ) {
      return agentError("VALIDATION_FAILED", "Email format is invalid.", 400);
    }

    // Hardening: validate addTags and removeTags are arrays of strings
    if (body.addTags !== undefined) {
      if (
        !Array.isArray(body.addTags) ||
        body.addTags.some((t) => typeof t !== "string")
      ) {
        return agentError(
          "VALIDATION_FAILED",
          "addTags must be an array of strings.",
          400
        );
      }
    }
    if (body.removeTags !== undefined) {
      if (
        !Array.isArray(body.removeTags) ||
        body.removeTags.some((t) => typeof t !== "string")
      ) {
        return agentError(
          "VALIDATION_FAILED",
          "removeTags must be an array of strings.",
          400
        );
      }
    }

    const loaded = await loadAuthorizedContact(request, id, "contacts:write");
    if (loaded instanceof NextResponse) return loaded;
    const { access, ref, contact } = loaded;

    if (typeof body.email === "string") {
      const nextEmail = body.email.trim().toLowerCase();
      const currentEmail = (contact.email as string | undefined) ?? "";
      if (nextEmail === "") {
        const effectivePhone =
          typeof body.phone === "string"
            ? body.phone.trim()
            : ((contact.phone as string | undefined) ?? "");
        if (!effectivePhone) {
          return agentError(
            "VALIDATION_FAILED",
            "Contact must keep an email or a phone.",
            400
          );
        }
      } else if (nextEmail !== currentEmail) {
        const dup = await getAdminDb()
          .collection("contacts")
          .where("subAccountId", "==", contact.subAccountId)
          .where("email", "==", nextEmail)
          .limit(1)
          .get();
        if (!dup.empty && dup.docs[0].id !== id) {
          return agentError(
            "VALIDATION_FAILED",
            "A contact with this email already exists in the sub-account.",
            409,
            { existingId: dup.docs[0].id }
          );
        }
      }
    }

    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    // Hardening: guard non-string inputs with typeof check
    if (typeof body.name === "string") update.name = body.name.trim();
    if (typeof body.company === "string") update.company = body.company.trim();
    if (typeof body.phone === "string") update.phone = body.phone.trim();
    if (typeof body.email === "string")
      update.email = body.email.trim().toLowerCase();

    // Tags: read-modify-write (intentionally no FieldValue.arrayUnion — we
    // already hold the doc, and plain arrays are testable + ordered).
    let actuallyAdded: string[] = [];
    if (body.addTags || body.removeTags) {
      const current = (contact.tags as string[]) ?? [];
      const removeSet = new Set(
        (body.removeTags ?? []).map((t) => t.trim().slice(0, 50))
      );
      const next = current.filter((t) => !removeSet.has(t));
      for (const raw of body.addTags ?? []) {
        const t = raw.trim().slice(0, 50);
        // Don't re-add tags that were explicitly removed in this call
        if (t && !removeSet.has(t) && !next.includes(t)) next.push(t);
      }
      update.tags = next;
      actuallyAdded = next.filter((t) => !current.includes(t));
    }

    const stageChanged =
      body.pipelineStage !== undefined &&
      body.pipelineStage !== contact.pipelineStage;
    if (stageChanged) update.pipelineStage = body.pipelineStage;

    await ref.update(update);

    if (actuallyAdded.length > 0) {
      try {
        await fireTagAddedTriggers({
          agencyId: contact.agencyId as string,
          subAccountId: contact.subAccountId as string,
          contactId: id,
          addedTags: actuallyAdded,
        });
      } catch (err) {
        console.warn("[agent contacts] tag triggers failed", err);
      }
    }

    if (stageChanged) {
      await getAdminDb()
        .collection(`contacts/${id}/activities`)
        .add({
          type: "pipeline_moved",
          content: `Pipeline stage set to ${body.pipelineStage}`,
          createdBy: `agent:${access.keyPrefix}`,
          createdAt: FieldValue.serverTimestamp(),
        });
    }

    const after = await ref.get();
    const a = after.data() as Record<string, unknown>;
    return NextResponse.json({
      data: { id, tags: a.tags, pipelineStage: a.pipelineStage },
    });
  }
);
