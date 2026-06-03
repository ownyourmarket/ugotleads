import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import type { PartnerNetworkEventStatus } from "@/types/partner-network";
import type { MemberStatus, Role } from "@/types";

/**
 * POST /api/agency/partner-network-events/status
 *
 * Owner-gated update of an outbox event's STATUS + export metadata ONLY.
 * partner_network_events writes are server-only (Firestore rules), so the admin
 * report routes status changes through here.
 *
 * ── Strict field allow-list ───────────────────────────────────────────────────
 * This route may only touch: status, errorMessage, exportAttempts,
 * lastExportAttemptAt, updatedAt. It NEVER modifies eventType, entityId,
 * payload, agencyId, idempotencyKey, occurredAt, or any core entity data.
 *
 * ── Security ────────────────────────────────────────────────────────────────
 * Auth → active → agencyRole === "owner" → event.agencyId === caller agency.
 *
 * ── Not in scope ──────────────────────────────────────────────────────────────
 * No exporter, no external API calls, no MLM logic, no checkout/Stripe/commission
 * /entitlement changes. This only annotates the outbox for manual tracking.
 *
 * ── Request body ────────────────────────────────────────────────────────────
 * { eventId: string; status: "pending"|"exported"|"ignored"|"failed"; note?: string|null }
 */

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyRole?: "owner" | "staff" | null;
  agencyId?: string | null;
}

const STATUSES: PartnerNetworkEventStatus[] = ["pending", "exported", "ignored", "failed"];

export async function POST(request: Request) {
  // Auth + role
  const uid = request.headers.get("x-user-uid");
  if (!uid) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const record = await getAdminAuth().getUser(uid).catch(() => null);
  if (!record) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const claims = (record.customClaims ?? {}) as CallerClaims;
  if (claims.status !== "active") return NextResponse.json({ error: "Account inactive." }, { status: 403 });
  if (claims.agencyRole !== "owner" || !claims.agencyId) {
    return NextResponse.json({ error: "Agency owner access required." }, { status: 403 });
  }
  const agencyId = claims.agencyId;

  // Parse body
  let body: { eventId?: string; status?: string; note?: string | null };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const { eventId, status, note = null } = body;

  if (!eventId) return NextResponse.json({ error: "eventId is required." }, { status: 400 });
  if (!status || !STATUSES.includes(status as PartnerNetworkEventStatus)) {
    return NextResponse.json({ error: `status must be one of: ${STATUSES.join(", ")}.` }, { status: 400 });
  }
  if (note !== null && typeof note === "string" && note.length > 500) {
    return NextResponse.json({ error: "note must be ≤500 chars." }, { status: 400 });
  }

  const db = getAdminDb();
  const ref = db.doc(`partner_network_events/${eventId}`);
  const snap = await ref.get().catch(() => null);
  if (!snap?.exists) {
    return NextResponse.json({ error: `Event ${eventId} not found.` }, { status: 404 });
  }

  // Tenancy
  const ev = snap.data() as { agencyId: string };
  if (ev.agencyId !== agencyId) {
    return NextResponse.json({ error: "Event does not belong to your agency." }, { status: 403 });
  }

  // Build a STRICTLY-SCOPED update — status/export metadata only.
  const updates: Record<string, unknown> = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (status === "failed") {
    updates.errorMessage = (typeof note === "string" && note.trim()) ? note.trim() : "Marked failed by admin.";
  } else if (status === "exported") {
    // Manual export marker — record the attempt metadata.
    updates.exportAttempts = FieldValue.increment(1);
    updates.lastExportAttemptAt = FieldValue.serverTimestamp();
    updates.errorMessage = null;
  } else {
    // pending / ignored — clear any prior error.
    updates.errorMessage = null;
  }

  await ref.update(updates);

  console.info(`[partner-events/status] Owner ${uid} set ${eventId} → ${status}`);

  return NextResponse.json({ ok: true, eventId, status });
}
