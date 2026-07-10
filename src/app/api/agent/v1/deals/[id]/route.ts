import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import {
  requireServiceAuth,
  subAccountAllowed,
} from "@/lib/auth/require-service-auth";
import { DEAL_PRIORITIES, PIPELINE_STAGES, getStage } from "@/types/deals";

export const PATCH = withAgentRoute<{ params: Promise<{ id: string }> }>(async (
  request,
  ctx,
) => {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as {
    title?: string;
    value?: number;
    stageId?: string;
    priority?: string;
    lostReason?: string | null;
  } | null;
  if (!body) return agentError("VALIDATION_FAILED", "Invalid JSON body.", 400);
  if (body.stageId !== undefined && !PIPELINE_STAGES.some((s) => s.id === body.stageId)) {
    return agentError("VALIDATION_FAILED", "Unknown stageId.", 400);
  }
  if (body.priority !== undefined && !DEAL_PRIORITIES.some((p) => p.id === body.priority)) {
    return agentError("VALIDATION_FAILED", "Unknown priority.", 400);
  }

  const access = await requireServiceAuth(request, { scope: "deals:write" });
  if (access instanceof NextResponse) return access;

  const db = getAdminDb();
  const ref = db.doc(`deals/${id}`);
  const snap = await ref.get();
  if (!snap.exists) return agentError("NOT_FOUND", "Deal not found.", 404);
  const deal = snap.data() as Record<string, unknown>;
  if (!subAccountAllowed(access, deal.subAccountId as string)) {
    // Doc-ID-resolved foreign tenant: 404, not 403 — don't reveal existence.
    return agentError("NOT_FOUND", "Deal not found.", 404);
  }

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  // Hardening: safely extract title only if it's a string
  if (body.title !== undefined && typeof body.title === "string" && body.title.trim()) {
    update.title = body.title.trim();
  }
  if (typeof body.value === "number" && Number.isFinite(body.value) && body.value >= 0) {
    update.value = body.value;
  }
  if (body.priority !== undefined) update.priority = body.priority;
  // Hardening: null clears the reason; only strings (trimmed) are stored; other types ignored
  if (body.lostReason === null) {
    update.lostReason = null;
  } else if (typeof body.lostReason === "string") {
    update.lostReason = body.lostReason.trim();
  }

  const stageChanged = body.stageId !== undefined && body.stageId !== deal.stageId;
  if (stageChanged) {
    update.stageId = body.stageId;
    update.stageChangedAt = FieldValue.serverTimestamp();
  }

  await ref.update(update);

  if (stageChanged) {
    await db.collection(`contacts/${deal.contactId as string}/activities`).add({
      type: "pipeline_moved",
      content: `Deal "${deal.title as string}" moved to ${getStage(body.stageId).label}`,
      createdBy: `agent:${access.keyPrefix}`,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  const after = await ref.get();
  return NextResponse.json({ data: { id, stageId: after.data()?.stageId } });
});
