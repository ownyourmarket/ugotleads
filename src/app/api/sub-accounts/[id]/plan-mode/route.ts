import "server-only";

import { NextResponse } from "next/server";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import { getAdminDb } from "@/lib/firebase/admin";
import type { PlanMode } from "@/types/tenancy";

const VALID_PLAN_MODES: PlanMode[] = ["credit", "subscription", "byok"];

/**
 * PATCH /api/sub-accounts/[id]/plan-mode
 *
 * Persists the operator's chosen Revenue OS access model to
 * `subAccounts/{id}.planMode`.
 *
 * ── Authorization ────────────────────────────────────────────────────────────
 * Uses `requireSubAccountAdmin` — the same guard used by every other
 * sub-account mutation route. Agency owners and sub-account admins are
 * permitted; collaborators and unauthenticated callers are rejected.
 *
 * ── Body ─────────────────────────────────────────────────────────────────────
 *   { "planMode": "credit" | "subscription" | "byok" }
 *
 * ── Response ─────────────────────────────────────────────────────────────────
 *   200  { ok: true, planMode: PlanMode }
 *   400  { error: "invalid_plan_mode" }
 *   401  Not authenticated
 *   403  Insufficient permissions
 *   500  Firestore error
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  let body: { planMode?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const planMode = body?.planMode;
  if (!planMode || !VALID_PLAN_MODES.includes(planMode as PlanMode)) {
    return NextResponse.json(
      {
        error: "invalid_plan_mode",
        message: `planMode must be one of: ${VALID_PLAN_MODES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  try {
    await getAdminDb()
      .doc(`subAccounts/${id}`)
      .set({ planMode: planMode as PlanMode, updatedAt: new Date() }, { merge: true });

    return NextResponse.json({ ok: true, planMode });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Firestore write failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
