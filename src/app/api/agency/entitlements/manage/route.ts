import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import type { MemberStatus, Role } from "@/types";

/**
 * POST /api/agency/entitlements/manage
 *
 * Agency-owner-only management of product_entitlements rows. Entitlement writes
 * are server-only (Firestore rules: allow write: if false), so the admin UI
 * routes revoke/reactivate/note actions through here.
 *
 * ── Security ────────────────────────────────────────────────────────────────
 * Guard 1 — Auth: x-user-uid from middleware, active status.
 * Guard 2 — Role: agencyRole must be "owner".
 * Guard 3 — Tenancy: entitlement.agencyId must equal the caller's agencyId.
 *
 * ── Request body ────────────────────────────────────────────────────────────
 * {
 *   entitlementId: string;             // `${customerUserId}_${productId}`
 *   action: "revoke" | "reactivate" | "note";
 *   internalNote?: string | null;      // set on any action; required intent for "note"
 * }
 *
 * ── What this does NOT do ─────────────────────────────────────────────────────
 * - No checkout / Stripe activation. No commission math. No customer email.
 * - No MLM / genealogy / downline / rank / team-volume / compensation logic.
 */

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyRole?: "owner" | "staff" | null;
  agencyId?: string | null;
}

type Action = "revoke" | "reactivate" | "note";
const ACTIONS: Action[] = ["revoke", "reactivate", "note"];

export async function POST(request: Request) {
  // Guard 1 — auth
  const uid = request.headers.get("x-user-uid");
  if (!uid) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const record = await getAdminAuth().getUser(uid).catch(() => null);
  if (!record) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const claims = (record.customClaims ?? {}) as CallerClaims;
  if (claims.status !== "active") {
    return NextResponse.json({ error: "Account inactive." }, { status: 403 });
  }
  // Guard 2 — role
  if (claims.agencyRole !== "owner" || !claims.agencyId) {
    return NextResponse.json({ error: "Agency owner access required." }, { status: 403 });
  }
  const agencyId = claims.agencyId;

  // Parse body
  let body: { entitlementId?: string; action?: string; internalNote?: string | null };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { entitlementId, action, internalNote = null } = body;

  if (!entitlementId) {
    return NextResponse.json({ error: "entitlementId is required." }, { status: 400 });
  }
  if (!action || !ACTIONS.includes(action as Action)) {
    return NextResponse.json(
      { error: `action must be one of: ${ACTIONS.join(", ")}.` },
      { status: 400 },
    );
  }
  if (internalNote !== null && typeof internalNote === "string" && internalNote.length > 500) {
    return NextResponse.json({ error: "internalNote must be ≤500 chars." }, { status: 400 });
  }

  const db = getAdminDb();
  const ref = db.doc(`product_entitlements/${entitlementId}`);
  const snap = await ref.get().catch(() => null);

  if (!snap?.exists) {
    return NextResponse.json({ error: `Entitlement ${entitlementId} not found.` }, { status: 404 });
  }

  // Guard 3 — tenancy
  const ent = snap.data() as { agencyId: string; status: string };
  if (ent.agencyId !== agencyId) {
    return NextResponse.json({ error: "Entitlement does not belong to your agency." }, { status: 403 });
  }

  // Build the update
  const updates: Record<string, unknown> = {
    reviewedByUid: uid,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (action === "revoke") {
    updates.status = "revoked";
    updates.revokedAt = FieldValue.serverTimestamp();
  } else if (action === "reactivate") {
    updates.status = "active";
    updates.revokedAt = null;
    // grantedAt is left as-is to preserve the original grant timestamp.
  }
  // "note" action: status unchanged.

  if (internalNote !== null) {
    updates.internalNote = internalNote.trim() || null;
  }

  await ref.update(updates);

  console.info(
    `[entitlements/manage] Owner ${uid} performed "${action}" on ${entitlementId}`,
  );

  return NextResponse.json({
    ok: true,
    entitlementId,
    action,
    newStatus:
      action === "revoke" ? "revoked" : action === "reactivate" ? "active" : ent.status,
  });
}
