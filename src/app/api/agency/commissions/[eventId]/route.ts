import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import type { MemberStatus, Role } from "@/types";
import type { CommissionStatus } from "@/types/credits";

/**
 * PATCH /api/agency/commissions/[eventId]
 *
 * Admin action on a commission event: mark paid or void.
 * Also updates the partner profile's pendingCommissionCents accordingly.
 *
 * ── Authorization ────────────────────────────────────────────────────────────
 * Agency owner only (agencyRole === "owner" in custom claims).
 *
 * ── Body ─────────────────────────────────────────────────────────────────────
 *   Mark paid: { "action": "mark_paid", "note": "optional note" }
 *   Void:      { "action": "void",      "reason": "optional reason" }
 *
 * ── Response ─────────────────────────────────────────────────────────────────
 *   200  { ok: true }
 *   400  bad body / invalid action / event not in "pending" state
 *   401  not authenticated
 *   403  not agency owner
 *   404  event not found
 *   500  Firestore error
 */

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyRole?: "owner" | "staff" | null;
  agencyId?: string | null;
}

async function requireAgencyOwner(
  request: Request,
): Promise<{ uid: string; agencyId: string } | NextResponse> {
  const uid = request.headers.get("x-user-uid");
  if (!uid)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const record = await getAdminAuth().getUser(uid).catch(() => null);
  if (!record)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const claims = (record.customClaims ?? {}) as CallerClaims;
  if (claims.status !== "active")
    return NextResponse.json({ error: "Account inactive." }, { status: 403 });
  if (claims.agencyRole !== "owner" || !claims.agencyId)
    return NextResponse.json(
      { error: "Agency owner access required." },
      { status: 403 },
    );

  return { uid, agencyId: claims.agencyId };
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await ctx.params;
  const auth = await requireAgencyOwner(request);
  if (auth instanceof NextResponse) return auth;

  let body: { action?: string; note?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body?.action;
  if (action !== "mark_paid" && action !== "void") {
    return NextResponse.json(
      { error: "action must be 'mark_paid' or 'void'" },
      { status: 400 },
    );
  }

  const db = getAdminDb();

  // Load the event and verify it belongs to this agency + is still pending.
  const eventRef = db.doc(`commission_events/${eventId}`);
  const eventSnap = await eventRef.get().catch(() => null);
  if (!eventSnap || !eventSnap.exists) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }

  const event = eventSnap.data() as {
    agencyId: string;
    status: CommissionStatus;
    commissionCents: number;
    partnerProfileId: string;
  };

  if (event.agencyId !== auth.agencyId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  if (event.status !== "pending") {
    return NextResponse.json(
      { error: `Event is already "${event.status}" — cannot update.` },
      { status: 400 },
    );
  }

  const newStatus: CommissionStatus = action === "mark_paid" ? "paid" : "voided";
  const now = FieldValue.serverTimestamp();

  // Build the event update.
  const eventUpdate: Record<string, unknown> = {
    status: newStatus,
    updatedAt: now,
  };
  if (newStatus === "paid") {
    eventUpdate.paidOutAt = now;
    if (body.note) eventUpdate.paidOutNote = body.note.trim().slice(0, 500);
  }
  if (newStatus === "voided") {
    eventUpdate.voidedAt = now;
    if (body.reason) eventUpdate.voidReason = body.reason.trim().slice(0, 500);
  }

  try {
    const batch = db.batch();

    // Update the commission event.
    batch.update(eventRef, eventUpdate);

    // Update the partner profile totals.
    // For both paid and voided: decrement pendingCommissionCents.
    // For paid only: lifetimeCommissionCents is already incremented at event
    // creation time so we don't touch it here.
    const profileRef = db.doc(`partner_profiles/${event.partnerProfileId}`);
    batch.update(profileRef, {
      pendingCommissionCents: FieldValue.increment(-event.commissionCents),
      updatedAt: now,
    });

    await batch.commit();

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Firestore write failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
