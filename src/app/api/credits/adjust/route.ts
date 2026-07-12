import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { serverApplyCreditDelta } from "@/lib/credits/server";
import type { MemberStatus, Role } from "@/types";
import type { CreditTxnType } from "@/types/credits";

/**
 * POST /api/credits/adjust
 *
 * Agency-owner-only endpoint to apply a credit balance delta to a partner's
 * credit wallet. Uses Admin SDK to bypass client-side Firestore rules that
 * block wallet updates.
 *
 * ── Security ────────────────────────────────────────────────────────────────
 * Guard 1 — Auth: x-user-uid from middleware, active status required.
 * Guard 2 — Role: agencyRole must be "owner". Partners cannot adjust their
 *           own balance, and staff cannot adjust partner balances.
 * Guard 3 — Agency match: partnerProfileId must belong to the caller's agency.
 *
 * ── What this route does NOT do ─────────────────────────────────────────────
 * - Does NOT activate Stripe checkout.
 * - Does NOT change commission math.
 * - Does NOT create commission events.
 * - No MLM, genealogy, binary, unilevel, downline, rank, team-volume, or
 *   compensation plan logic.
 *
 * ── Request body ────────────────────────────────────────────────────────────
 * {
 *   partnerProfileId: string;        // uid of the partner
 *   delta: number;                   // positive = add, negative = deduct
 *   type: "purchase"|"adjustment"|"refund";  // "spend" reserved for system use
 *   description: string;             // required, shown in transaction history
 *   referenceId?: string | null;
 * }
 */

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyRole?: "owner" | "staff" | null;
  agencyId?: string | null;
}

const ADMIN_ADJUSTABLE_TYPES: CreditTxnType[] = ["purchase", "adjustment", "refund"];

export async function POST(request: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const uid = request.headers.get("x-user-uid");
  if (!uid) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const record = await getAdminAuth().getUser(uid).catch(() => null);
  if (!record) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const claims = (record.customClaims ?? {}) as CallerClaims;
  if (claims.status !== "active") {
    return NextResponse.json({ error: "Account inactive." }, { status: 403 });
  }
  if (claims.agencyRole !== "owner" || !claims.agencyId) {
    return NextResponse.json(
      { error: "Agency owner access required." },
      { status: 403 },
    );
  }

  const agencyId = claims.agencyId;

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: {
    partnerProfileId?: string;
    delta?: number;
    type?: string;
    description?: string;
    referenceId?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { partnerProfileId, delta, type, description, referenceId = null } = body;

  if (!partnerProfileId) {
    return NextResponse.json({ error: "partnerProfileId is required." }, { status: 400 });
  }
  if (delta === undefined || delta === null || delta === 0) {
    return NextResponse.json({ error: "delta must be a non-zero number." }, { status: 400 });
  }
  if (typeof delta !== "number" || !isFinite(delta)) {
    return NextResponse.json({ error: "delta must be a finite number." }, { status: 400 });
  }
  if (!type || !ADMIN_ADJUSTABLE_TYPES.includes(type as CreditTxnType)) {
    return NextResponse.json(
      {
        error: `type must be one of: ${ADMIN_ADJUSTABLE_TYPES.join(", ")}.`,
        note: '"spend" is reserved for system use (AI runs, product access). Use "adjustment" for manual corrections.',
      },
      { status: 400 },
    );
  }
  if (!description || description.trim().length === 0) {
    return NextResponse.json({ error: "description is required." }, { status: 400 });
  }
  if (description.trim().length > 500) {
    return NextResponse.json({ error: "description must be ≤500 chars." }, { status: 400 });
  }

  const db = getAdminDb();

  // ── Verify partner belongs to caller's agency ─────────────────────────────
  const partnerSnap = await db.doc(`partner_profiles/${partnerProfileId}`).get().catch(() => null);
  if (!partnerSnap?.exists) {
    return NextResponse.json(
      { error: `Partner profile ${partnerProfileId} not found.` },
      { status: 404 },
    );
  }
  const partner = partnerSnap.data() as { agencyId: string; fullName?: string; status?: string };
  if (partner.agencyId !== agencyId) {
    return NextResponse.json(
      { error: "Partner does not belong to your agency." },
      { status: 403 },
    );
  }

  // ── Apply delta ───────────────────────────────────────────────────────────
  const result = await serverApplyCreditDelta({
    agencyId,
    partnerProfileId,
    delta,
    type: type as CreditTxnType,
    description: description.trim(),
    referenceId,
    referenceType: "admin_approval",
    createdByUid: uid,
  });

  if ("error" in result) {
    return NextResponse.json(
      { error: result.message },
      { status: 500 },
    );
  }

  if ("skipped" in result) {
    // This route never passes a deterministic transactionId, so a duplicate
    // should be unreachable — treat as an internal error rather than silently
    // reporting success with no delta applied.
    return NextResponse.json(
      { error: "Unexpected duplicate transaction — no changes applied." },
      { status: 500 },
    );
  }

  console.info(
    `[credits/adjust] Owner ${uid} applied ${result.actualDelta} credits to partner ${partnerProfileId} (${partner.fullName ?? "unknown"}) — new balance: ${result.newBalance}`,
  );

  return NextResponse.json({
    ok: true,
    partnerProfileId,
    requestedDelta: delta,
    actualDelta: result.actualDelta,
    newBalance: result.newBalance,
    transactionId: result.transactionId,
    type,
    note:
      result.actualDelta !== delta
        ? `Balance was clamped to 0 — actual delta was ${result.actualDelta} instead of ${delta}.`
        : `Credit balance updated successfully.`,
  });
}
