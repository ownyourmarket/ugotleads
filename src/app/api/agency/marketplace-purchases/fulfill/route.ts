import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { grantProductEntitlement } from "@/lib/fulfillment/grant-entitlement";
import type { AccessModel, ProductFamily } from "@/types/products";
import type { MemberStatus, Role } from "@/types";

/**
 * POST /api/agency/marketplace-purchases/fulfill
 *
 * Owner-gated repair tool: when a paid marketplace purchase exists but the
 * webhook fulfillment never granted an entitlement (e.g. fulfillment hook
 * failed, rules weren't deployed at the time, or the webhook was missed), the
 * agency owner can manually grant the entitlement from the purchases admin view.
 *
 * Re-uses grantProductEntitlement() so manual repair and webhook fulfillment
 * produce identical entitlement docs. Idempotent.
 *
 * ── Security ────────────────────────────────────────────────────────────────
 * Guard 1 — Auth: x-user-uid, active.
 * Guard 2 — Role: agencyRole === "owner".
 * Guard 3 — Tenancy: purchase.agencyId === caller's agencyId.
 *
 * ── Request body ────────────────────────────────────────────────────────────
 * { sessionId: string; note?: string | null }   // sessionId === purchase doc id
 *
 * ── Result statuses ───────────────────────────────────────────────────────────
 * fulfilled | already_fulfilled | not_paid | product_missing | customer_missing | error
 *
 * ── Not in scope ──────────────────────────────────────────────────────────────
 * No checkout / Stripe activation, no commission math, no email, no MLM logic.
 */

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyRole?: "owner" | "staff" | null;
  agencyId?: string | null;
}

export async function POST(request: Request) {
  // Guard 1 — auth
  const uid = request.headers.get("x-user-uid");
  if (!uid) return NextResponse.json({ status: "error", error: "Not authenticated." }, { status: 401 });

  const record = await getAdminAuth().getUser(uid).catch(() => null);
  if (!record) return NextResponse.json({ status: "error", error: "Not authenticated." }, { status: 401 });

  const claims = (record.customClaims ?? {}) as CallerClaims;
  if (claims.status !== "active") {
    return NextResponse.json({ status: "error", error: "Account inactive." }, { status: 403 });
  }
  // Guard 2 — role
  if (claims.agencyRole !== "owner" || !claims.agencyId) {
    return NextResponse.json({ status: "error", error: "Agency owner access required." }, { status: 403 });
  }
  const agencyId = claims.agencyId;

  // Parse body
  let body: { sessionId?: string; note?: string | null };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const sessionId = body.sessionId?.trim();
  const note = (body.note ?? null) as string | null;
  if (!sessionId) {
    return NextResponse.json({ status: "error", error: "sessionId is required." }, { status: 400 });
  }

  const db = getAdminDb();
  const purchaseRef = db.doc(`marketplace_purchases/${sessionId}`);
  const purchaseSnap = await purchaseRef.get().catch(() => null);

  if (!purchaseSnap?.exists) {
    return NextResponse.json(
      { status: "error", error: `Purchase ${sessionId} not found.` },
      { status: 404 },
    );
  }

  const purchase = purchaseSnap.data() as {
    agencyId: string;
    subAccountId: string | null;
    customerUserId: string;
    productId: string;
    productName: string;
    productFamily: ProductFamily | null;
    paymentStatus: string;
    fulfilledAt?: unknown;
    entitlementId?: string | null;
  };

  // Guard 3 — tenancy
  if (purchase.agencyId !== agencyId) {
    return NextResponse.json(
      { status: "error", error: "Purchase does not belong to your agency." },
      { status: 403 },
    );
  }

  // ── Precondition: already fulfilled ───────────────────────────────────────
  if (purchase.fulfilledAt) {
    return NextResponse.json({
      status: "already_fulfilled",
      sessionId,
      entitlementId: purchase.entitlementId ?? null,
      note: "This purchase already has an entitlement. No action taken.",
    });
  }

  // ── Precondition: must be paid ────────────────────────────────────────────
  if (purchase.paymentStatus !== "paid") {
    return NextResponse.json(
      {
        status: "not_paid",
        sessionId,
        paymentStatus: purchase.paymentStatus,
        note: "Only paid purchases can be fulfilled.",
      },
      { status: 422 },
    );
  }

  // ── Precondition: product + customer present ──────────────────────────────
  if (!purchase.productId) {
    return NextResponse.json({ status: "product_missing", sessionId }, { status: 422 });
  }
  if (!purchase.customerUserId) {
    return NextResponse.json({ status: "customer_missing", sessionId }, { status: 422 });
  }

  // Refresh access model from the live product doc (best-effort fallback).
  const productSnap = await db.doc(`products/${purchase.productId}`).get().catch(() => null);
  const accessModel =
    ((productSnap?.data() as { accessModel?: AccessModel } | undefined)?.accessModel ??
      "subscription") as AccessModel;

  // ── Grant entitlement (idempotent) ────────────────────────────────────────
  const fulfill = await grantProductEntitlement({
    agencyId,
    customerUserId: purchase.customerUserId,
    productId: purchase.productId,
    subAccountId: purchase.subAccountId ?? null,
    productName: purchase.productName,
    productFamily: purchase.productFamily ?? null,
    accessModel,
    grantingSessionId: sessionId,
  });

  if (!("ok" in fulfill)) {
    return NextResponse.json(
      { status: "error", sessionId, error: fulfill.message },
      { status: 500 },
    );
  }

  // ── Backfill the purchase doc with audit fields ───────────────────────────
  await purchaseRef.update({
    entitlementId: fulfill.entitlementId,
    fulfilledAt: FieldValue.serverTimestamp(),
    fulfillmentSource: "manual_repair",
    fulfilledByUid: uid,
    fulfillmentNote: note?.trim() || null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.info(
    `[fulfill-repair] Owner ${uid} repaired fulfillment for purchase ${sessionId} → entitlement ${fulfill.entitlementId}`,
  );

  return NextResponse.json({
    status: "fulfilled",
    sessionId,
    entitlementId: fulfill.entitlementId,
    alreadyActive: fulfill.alreadyActive,
    note: "Entitlement granted and purchase marked fulfilled (manual_repair).",
  });
}
