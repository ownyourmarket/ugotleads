import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { enforceDailyCap } from "@/lib/agent-api/caps";
import { withIdempotency } from "@/lib/agent-api/idempotency";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import { requireServiceAuth, subAccountAllowed } from "@/lib/auth/require-service-auth";
import { enrollContact } from "@/lib/automations/triggers";
import type { AutomationDoc } from "@/types";

const MAX_BATCH = 200;
const DAILY_ENROLL_CAP = 500;

export const POST = withAgentRoute<{ params: Promise<{ id: string }> }>(
  async (request, ctx) => {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as {
      contactIds?: string[];
      tag?: string;
      confirm?: { expectedCount?: number; summary?: string };
    } | null;
    if (!body) return agentError("VALIDATION_FAILED", "Invalid JSON body.", 400);

    const hasIds = Array.isArray(body.contactIds) && body.contactIds.length > 0;
    const tag = typeof body.tag === "string" ? body.tag.trim() : "";
    if (hasIds === !!tag) {
      return agentError("VALIDATION_FAILED", "Provide exactly one of contactIds[] or tag.", 400);
    }
    if (hasIds && (body.contactIds as string[]).length > MAX_BATCH) {
      return agentError("VALIDATION_FAILED", `Max ${MAX_BATCH} contacts per enroll call.`, 400);
    }
    if (hasIds && (body.contactIds as string[]).some((c) => typeof c !== "string" || !c)) {
      return agentError("VALIDATION_FAILED", "contactIds must be non-empty strings.", 400);
    }

    const access = await requireServiceAuth(request, { scope: "sequences:enroll" });
    if (access instanceof NextResponse) return access;

    const db = getAdminDb();
    const autoSnap = await db.doc(`automations/${id}`).get();
    if (!autoSnap.exists) return agentError("NOT_FOUND", "Sequence not found.", 404);
    const automation = autoSnap.data() as AutomationDoc;
    if (!subAccountAllowed(access, automation.subAccountId)) {
      return agentError("NOT_FOUND", "Sequence not found.", 404);
    }
    if (automation.recipeType !== "outbound_sequence") {
      return agentError("VALIDATION_FAILED", "Automation is not an outbound sequence.", 400);
    }
    if (!automation.enabled) {
      return agentError("VALIDATION_FAILED", "Sequence is disabled.", 400);
    }

    // Resolve the audience.
    let audience: string[];
    if (hasIds) {
      audience = body.contactIds as string[];
    } else {
      const matches = await db
        .collection("contacts")
        .where("subAccountId", "==", automation.subAccountId)
        .where("tags", "array-contains", tag)
        .limit(MAX_BATCH)
        .get();
      audience = matches.docs.map((d) => d.id);
    }

    // Batch-approval gate: Star approves a campaign of N; the tool proves N.
    const expected = body.confirm?.expectedCount;
    if (typeof expected !== "number" || expected !== audience.length) {
      return agentError(
        "CONFIRM_MISMATCH",
        "confirm.expectedCount must equal the resolved audience size — re-check the batch with the operator before enrolling.",
        409,
        { expectedCount: expected ?? null, actualCount: audience.length },
      );
    }
    if (audience.length === 0) {
      return NextResponse.json({ data: { enrolled: 0, alreadyEnrolled: 0, skipped: [] } }, { status: 201 });
    }

    // Cap check runs as an idempotency preflight: a replay hit skips it
    // (retries never re-consume quota), and a capped 429 is never cached
    // (stays retryable once capacity frees up).
    return withIdempotency(
      request,
      access.keyId,
      "sequences:enroll",
      async () => {
        let enrolled = 0;
        let alreadyEnrolled = 0;
        const skipped: { contactId: string; reason: string }[] = [];
        for (const contactId of audience) {
          const contactSnap = await db.doc(`contacts/${contactId}`).get();
          if (!contactSnap.exists || contactSnap.data()?.subAccountId !== automation.subAccountId) {
            skipped.push({ contactId, reason: "not_found" });
            continue;
          }
          const outcome = await enrollContact({
            agencyId: automation.agencyId,
            subAccountId: automation.subAccountId,
            automation: { ...automation, id },
            contactId,
          });
          if (outcome === "enrolled") enrolled++;
          else if (outcome === "already_enrolled") alreadyEnrolled++;
          else skipped.push({ contactId, reason: outcome });
        }
        return { status: 201, body: { data: { enrolled, alreadyEnrolled, skipped } } };
      },
      { preflight: () => enforceDailyCap(access.keyId, "enrollments", DAILY_ENROLL_CAP, audience.length) },
    );
  },
);
