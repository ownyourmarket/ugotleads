import { NextResponse } from "next/server";
import { getStripeServer } from "@/lib/stripe/server";

/**
 * POST /api/checkout/public-subscription
 *
 * Unauthenticated endpoint that creates a Stripe Checkout subscription
 * session for a NEW operator. The flow:
 *
 *   1. Visitor clicks a tier on /#pricing → JS POSTs here with priceId + email
 *   2. We create a Stripe Checkout session with mode=subscription, prefill
 *      customer_email so Stripe collects the rest of the details
 *   3. metadata.kind = "self_serve_subscription" so the webhook knows to
 *      write a pendingSignups doc on checkout.session.completed
 *   4. Visitor pays → Stripe redirects to /signup?session=cs_...
 *   5. /signup detects the session id, posts it to /api/auth/signup
 *   6. Signup route reads pendingSignups, mints a new agency + Main
 *      sub-account, sets monthlyCapTokens based on the price tier, deletes
 *      the pendingSignups doc
 *
 * Public-path (no auth required) — protected by:
 *   - priceId allowlist (only our published prices are accepted)
 *   - Email format validation
 *   - Stripe handles fraud / 3DS / card auth on the checkout page itself
 */

// Tier slug -> env var holding the Stripe price id. Frontend never sees
// the raw price id; it sends `tier: "starter" | "pro" | "scale"` and the
// server maps to the right Stripe SKU. This keeps price ids out of the
// client bundle and lets us re-map tiers (e.g. promotional pricing) without
// touching frontend code.
const TIER_TO_PRICE_ENV: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRO_PRICE_ID, // Local Pro $197/mo
  pro: process.env.STRIPE_MULTI_SERVICE_PRICE_ID, // Multi-Service Operator $297/mo
  scale: process.env.STRIPE_TERRITORY_PARTNER_PRICE_ID, // Territory Partner $497/mo
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let body: { tier?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const tier = body.tier?.trim();
  const email = body.email?.trim().toLowerCase();

  const priceId = tier ? TIER_TO_PRICE_ENV[tier] : undefined;
  if (!priceId) {
    return NextResponse.json(
      {
        error: "tier_not_available",
        message:
          "That tier isn't set up for self-serve checkout yet. Reach out to us and we'll get you onboarded.",
      },
      { status: 400 },
    );
  }
  if (!email || !EMAIL_RE.test(email) || email.length > 200) {
    return NextResponse.json(
      { error: "invalid_email" },
      { status: 400 },
    );
  }

  const stripe = getStripeServer();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  if (!appUrl) {
    return NextResponse.json(
      { error: "app_url_missing" },
      { status: 503 },
    );
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      // metadata.kind is the discriminator the webhook reads to know this
      // is a brand-new operator subscribing self-serve (vs an existing
      // logged-in operator upgrading from the dashboard).
      metadata: {
        kind: "self_serve_subscription",
        priceId,
        email,
      },
      success_url: `${appUrl}/signup?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/#pricing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[checkout/public-subscription] Stripe error:", msg);
    return NextResponse.json(
      { error: "stripe_error", message: msg.slice(0, 300) },
      { status: 502 },
    );
  }
}
