import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import { withIdempotency } from "@/lib/agent-api/idempotency";
import {
  buildContactDoc,
  isValidEmail,
  type AgentContactInput,
} from "@/lib/agent-api/contact-defaults";
import { requireServiceAuth } from "@/lib/auth/require-service-auth";
import { fireTagAddedTriggers } from "@/lib/automations/tag-triggers";

export const POST = withAgentRoute(async (request: Request) => {
  const body = (await request.json().catch(() => null)) as
    | (AgentContactInput & { subAccountId?: string })
    | null;
  if (!body || typeof body.subAccountId !== "string" || !body.subAccountId) {
    return agentError("VALIDATION_FAILED", "subAccountId is required.", 400);
  }
  if (
    body.tags !== undefined &&
    (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== "string"))
  ) {
    return agentError("VALIDATION_FAILED", "tags must be an array of strings.", 400);
  }

  const access = await requireServiceAuth(request, {
    scope: "contacts:write",
    subAccountId: body.subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!email && !phone) {
    return agentError("VALIDATION_FAILED", "A valid email or a phone number is required.", 400);
  }
  if (email && !isValidEmail(email)) {
    return agentError("VALIDATION_FAILED", "Email format is invalid.", 400);
  }

  return withIdempotency(request, access.keyId, "contacts:create", async () => {
    const db = getAdminDb();
    const created = await db.runTransaction(async (tx) => {
      if (email) {
        const dup = await tx.get(
          db.collection("contacts")
            .where("subAccountId", "==", access.subAccountId)
            .where("email", "==", email)
            .limit(1),
        );
        if (!dup.empty) return { duplicateId: dup.docs[0].id as string };
      }
      const ref = db.collection("contacts").doc();
      tx.set(ref, buildContactDoc(access, body));
      return { id: ref.id };
    });
    if ("duplicateId" in created) {
      return {
        status: 409,
        body: {
          error: {
            code: "VALIDATION_FAILED",
            message: "A contact with this email already exists in the sub-account.",
            details: { existingId: created.duplicateId },
          },
        },
      };
    }

    const createdTags = (Array.isArray(body.tags) ? body.tags : []).filter(
      (t): t is string => typeof t === "string" && !!t.trim(),
    );
    if (createdTags.length) {
      try {
        await fireTagAddedTriggers({
          agencyId: access.agencyId,
          subAccountId: access.subAccountId as string,
          contactId: created.id,
          addedTags: createdTags,
        });
      } catch (err) {
        console.warn("[agent contacts] tag triggers failed", err);
      }
    }

    return { status: 201, body: { data: { id: created.id } } };
  });
});

export const GET = withAgentRoute(async (request: Request) => {
  const url = new URL(request.url);
  const subAccountId = url.searchParams.get("subAccountId");
  if (!subAccountId) {
    return agentError("VALIDATION_FAILED", "subAccountId query param is required.", 400);
  }

  const access = await requireServiceAuth(request, {
    scope: "contacts:read",
    subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
  let q = getAdminDb()
    .collection("contacts")
    .where("subAccountId", "==", subAccountId);
  const email = url.searchParams.get("email");
  const phone = url.searchParams.get("phone");
  const tag = url.searchParams.get("tag");
  const pipelineStage = url.searchParams.get("pipelineStage");
  if (email) q = q.where("email", "==", email.trim().toLowerCase());
  if (phone) q = q.where("phone", "==", phone.trim());
  if (tag) q = q.where("tags", "array-contains", tag);
  if (pipelineStage) q = q.where("pipelineStage", "==", pipelineStage);

  const snap = await q.limit(limit).get();
  const data = snap.docs.map((d) => {
    const c = d.data();
    return {
      id: d.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      company: c.company,
      tags: c.tags,
      pipelineStage: c.pipelineStage,
      emailOptedOut: c.emailOptedOut,
      smsOptedOut: c.smsOptedOut,
    };
  });
  return NextResponse.json({ data });
});
