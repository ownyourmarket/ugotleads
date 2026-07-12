import "server-only";

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getAdminDb } from "@/lib/firebase/admin";
import { getStripeServer } from "@/lib/stripe/server";
import { requireSubAccountMember } from "@/lib/auth/require-tenancy";
import { CREDIT_PACKS } from "@/types/promptexpert";

/**
 * POST /api/credits/topup/checkout
 *
 * Creates a Stripe Checkout Session (one-time payment) for a PromptExpert
 * credit top-up pack. Sibling of marketplace/checkout/route.ts — mirrors its
 * Stripe client init, origin resolution, and auth idiom. Differences from
 * that route (per the Phase 3 brief): `mode: "payment"` instead of
 * "subscription", an inline `price_data` line item instead of a Stripe price
 * ID (credit packs have no pre-created Stripe Price objects), and no
 * feature-flag/environment gate.
 *
 * ── Request body ────────────────────────────────────────────────────────────
 *
 * POST /api/credits/topup/checkout
 * { packId: "starter" | "growth" | "scale", subAccountId: string }
 *
 * ── Auth ─────────────────────────────────────────────────────────────────────
 * `requireSubAccountMember` — any active member of the sub-account may top up
 * its shared credit wallet, not just admins/owners.
 *
 * ── agencyId note ───────────────────────────────────────────────────────────
 * `requireSubAccountMember`'s return carries the *caller's own* agencyId
 * claim, which is only guaranteed to match the sub-account's owning agency
 * for the agencyOwner access path. For a plain sub-account member it can be
 * null or (in theory) a different agency. The true owning agencyId is read
 * from the `subAccounts/{id}` doc instead — same pattern as
 * `promptexpert/gpts/[gptId]/chat/route.ts` and
 * `comms/voice/campaign/send/route.ts`.
 *
 * ── Stripe session metadata ──────────────────────────────────────────────────
 * { kind: "credit_topup", packId, credits, agencyId, subAccountId, purchaserUid }
 *
 * Fulfillment (the checkout.session.completed webhook) applies the credit
 * grant from this metadata, so every field here must be present and correct.
 */

export async function POST(request: Request) {
  // Guard 1 — Stripe configuration. No feature-flag/environment gate here
  // (unlike marketplace checkout) per the brief.
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      {
        error: "Credit top-up checkout is not configured.",
        note: "Set STRIPE_SECRET_KEY to enable Stripe checkout sessions.",
      },
      { status: 503 },
    );
  }

  // Parse + validate body.
  let body: { packId?: string; subAccountId?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { packId, subAccountId } = body;

  if (typeof packId !== "string" || packId.length === 0) {
    return NextResponse.json({ error: "packId is required." }, { status: 400 });
  }
  if (typeof subAccountId !== "string" || subAccountId.length === 0) {
    return NextResponse.json({ error: "subAccountId is required." }, { status: 400 });
  }

  // Guard 2 — auth. Any active sub-account member may top up.
  const auth = await requireSubAccountMember(request, subAccountId);
  if (auth instanceof NextResponse) return auth;

  // Guard 3 — pack lookup.
  const pack = CREDIT_PACKS.find((p) => p.id === packId);
  if (!pack) {
    return NextResponse.json({ error: "unknown_pack" }, { status: 400 });
  }

  // ── Resolve the sub-account's true owning agencyId + wallet-binding guard ──
  // See the agencyId note above — do not trust auth.agencyId (the caller's
  // own claim) for the metadata stamped on the Stripe session. Both reads are
  // wrapped together since a Firestore outage should surface as one 500,
  // distinct from a downstream Stripe failure (handled separately below).
  const db = getAdminDb();
  let subSnap: FirebaseFirestore.DocumentSnapshot;
  let walletSnap: FirebaseFirestore.DocumentSnapshot;
  try {
    subSnap = await db.doc(`subAccounts/${subAccountId}`).get();
    walletSnap = await db.doc(`credit_wallets/${auth.uid}`).get();
  } catch (err) {
    console.error("[credits/topup] Firestore read failed while preparing checkout", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  if (!subSnap.exists) {
    return NextResponse.json({ error: "Sub-account not found" }, { status: 404 });
  }
  const agencyId = (subSnap.data()?.agencyId as string | undefined) ?? "";

  // Guard 4 — cross-workspace purchase trap. A credit wallet's subAccountId,
  // once stamped, must never be silently rebound to a different sub-account
  // (mirrors the never-overwrite rule in ensureTopupWallet, src/lib/stripe/
  // webhooks.ts) — so refuse to even start a checkout that would attempt it.
  if (walletSnap.exists) {
    const boundSubAccountId =
      (walletSnap.data()?.subAccountId as string | null | undefined) ?? null;
    if (boundSubAccountId !== null && boundSubAccountId !== subAccountId) {
      return NextResponse.json(
        {
          error: "wallet_bound_elsewhere",
          message:
            "Your credit wallet is attached to a different workspace. Top up from that workspace, or contact support.",
        },
        { status: 409 },
      );
    }
  }

  // ── Create Stripe Checkout Session ───────────────────────────────────────
  const stripe = getStripeServer();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: pack.priceUsdCents,
            product_data: {
              name: `UGotLeads Credits — ${pack.name} (${pack.credits} credits)`,
            },
          },
        },
      ],
      success_url: `${appUrl}/sa/${subAccountId}/credits?topup=success`,
      cancel_url: `${appUrl}/sa/${subAccountId}/credits?topup=cancelled`,
      metadata: {
        kind: "credit_topup",
        packId: pack.id,
        credits: String(pack.credits),
        agencyId,
        subAccountId,
        purchaserUid: auth.uid,
      },
    });
  } catch (err) {
    console.error("[credits/topup] Stripe session creation failed", err);
    return NextResponse.json({ error: "checkout_unavailable" }, { status: 502 });
  }

  console.info(
    `[credits/topup/checkout] Session ${session.id} created — pack=${pack.id} subAccount=${subAccountId}`,
  );

  return NextResponse.json({ url: session.url });
}
