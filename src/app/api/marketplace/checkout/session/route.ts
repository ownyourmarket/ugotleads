import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";
import { getStripeServer } from "@/lib/stripe/server";
import type { MemberStatus, Role } from "@/types";

/**
 * GET /api/marketplace/checkout/session?session_id=cs_test_...
 *
 * Returns safe, non-sensitive fields from a Stripe Checkout Session.
 * Used by the checkout success page to display payment confirmation.
 *
 * ── Security model ──────────────────────────────────────────────────────────
 *
 * Guard 1 — Environment gate:
 *   Returns 403 when NODE_ENV === "production" unless
 *   MARKETPLACE_CHECKOUT_ENABLED=true. This session lookup is only
 *   available in test/local mode alongside the checkout itself.
 *
 * Guard 2 — Auth gate:
 *   x-user-uid from middleware. Active account required.
 *
 * Guard 3 — Ownership check:
 *   session.metadata.customerUserId must match the caller's uid.
 *   Prevents any user from looking up another user's session.
 *   session.metadata.agencyId must match the caller's agencyId.
 *
 * ── What is returned ────────────────────────────────────────────────────────
 * Only safe, non-sensitive fields. No payment method, card details, or
 * customer PII beyond what the user already provided.
 *
 * ── What is NOT activated ────────────────────────────────────────────────────
 * - Does not create or modify any Stripe objects.
 * - Does not activate production checkout.
 * - No commission math changes.
 * - No MLM / genealogy / downline / rank logic.
 */

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyId?: string | null;
}

function isCheckoutGated(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.MARKETPLACE_CHECKOUT_ENABLED !== "true"
  );
}

export async function GET(request: Request) {
  // Guard 1 — environment gate
  if (isCheckoutGated()) {
    return NextResponse.json(
      { error: "Session lookup is only available when MARKETPLACE_CHECKOUT_ENABLED=true." },
      { status: 403 },
    );
  }

  // Guard 2 — auth
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
  const agencyId = claims.agencyId ?? "";

  // Parse session_id from query string
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id")?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required." }, { status: 400 });
  }
  // Basic sanity check — Stripe session IDs start with cs_
  if (!sessionId.startsWith("cs_")) {
    return NextResponse.json(
      { error: "Invalid session_id format." },
      { status: 400 },
    );
  }

  // Fetch from Stripe
  const stripe = getStripeServer();
  const session = await stripe.checkout.sessions
    .retrieve(sessionId)
    .catch(() => null);

  if (!session) {
    return NextResponse.json(
      { error: "Session not found or could not be retrieved from Stripe." },
      { status: 404 },
    );
  }

  // Guard 3 — ownership
  const meta = session.metadata ?? {};
  if (meta.customerUserId !== uid) {
    return NextResponse.json(
      { error: "Session does not belong to this account." },
      { status: 403 },
    );
  }
  if (meta.agencyId !== agencyId) {
    return NextResponse.json(
      { error: "Session does not belong to this agency." },
      { status: 403 },
    );
  }

  // Return safe fields only — no payment method, no customer PII
  return NextResponse.json({
    ok: true,
    session: {
      id: session.id,
      status: session.status,                    // "open" | "complete" | "expired"
      payment_status: session.payment_status,    // "paid" | "unpaid" | "no_payment_required"
      amount_total: session.amount_total,        // cents
      currency: session.currency,
      metadata: {
        kind: meta.kind ?? null,
        productId: meta.productId ?? null,
        productFamily: meta.productFamily ?? null,
        subAccountId: meta.subAccountId ?? null,
        // Attribution — safe to return (no keys/secrets)
        referredByPartnerProfileId: meta.referredByPartnerProfileId || null,
        partnerReferralCode: meta.partnerReferralCode || null,
      },
    },
  });
}
