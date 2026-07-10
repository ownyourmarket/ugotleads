import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import { withIdempotency } from "@/lib/agent-api/idempotency";
import { requireServiceAuth } from "@/lib/auth/require-service-auth";
import { DEAL_PRIORITIES, PIPELINE_STAGES } from "@/types/deals";

export const POST = withAgentRoute(async (request: Request) => {
  const body = (await request.json().catch(() => null)) as {
    subAccountId?: string;
    contactId?: string;
    title?: string;
    value?: number;
    currency?: string;
    stageId?: string;
    priority?: string;
  } | null;

  // Hardening: safely extract title only if it's a string
  const title = typeof body?.title === "string" ? body.title.trim() : undefined;
  if (
    !body ||
    typeof body.subAccountId !== "string" ||
    typeof body.contactId !== "string" ||
    !title
  ) {
    return agentError(
      "VALIDATION_FAILED",
      "subAccountId, contactId, and title are required.",
      400
    );
  }
  const stageId = body.stageId ?? "new";
  if (!PIPELINE_STAGES.some((s) => s.id === stageId)) {
    return agentError("VALIDATION_FAILED", "Unknown stageId.", 400);
  }
  const priority = body.priority ?? "medium";
  if (!DEAL_PRIORITIES.some((p) => p.id === priority)) {
    return agentError("VALIDATION_FAILED", "Unknown priority.", 400);
  }

  const access = await requireServiceAuth(request, {
    scope: "deals:write",
    subAccountId: body.subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const db = getAdminDb();
  const contactSnap = await db.doc(`contacts/${body.contactId}`).get();
  if (
    !contactSnap.exists ||
    contactSnap.data()?.subAccountId !== body.subAccountId
  ) {
    return agentError(
      "NOT_FOUND",
      "Contact not found in this sub-account.",
      404
    );
  }

  const contactId = body.contactId;
  const value =
    typeof body.value === "number" &&
    Number.isFinite(body.value) &&
    body.value >= 0
      ? body.value
      : 0;
  // Hardening: safely extract currency only if it's a string
  const currency =
    typeof body.currency === "string" ? body.currency.trim() || "USD" : "USD";

  return withIdempotency(request, access.keyId, "deals:create", async () => {
    const ref = await db.collection("deals").add({
      title,
      value,
      currency,
      contactId,
      stageId,
      priority,
      agencyId: access.agencyId,
      subAccountId: access.subAccountId,
      createdByUid: `agent:${access.keyPrefix}`,
      lostReason: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      stageChangedAt: FieldValue.serverTimestamp(),
    });
    return { status: 201, body: { data: { id: ref.id } } };
  });
});
