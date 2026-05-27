import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type Stripe from "stripe";
import { getStripeServer } from "@/lib/stripe/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { LANDING_VARIANT } from "@/config/landing";
import { REF_COOKIE_NAME } from "@/lib/affiliate/ref-cookie";

export const dynamic = "force-dynamic";

/**
 * Anonymous one-time payment checkout for the Founders Cohort SKU.
 * No auth — public buyers click "Claim Founders slot" and get redirected
 * to Stripe Checkout. On success Stripe redirects back to /thank-you.
 *
 * The current wave is read from `appConfig/foundersCohort` and stamped
 * into the session metadata so we can reconcile which bonus stack each
 * buyer is owed.
 *
 * Optional body: { discountCode?: string } — when present, looks up the
 * matching active Stripe promotion code and pre-applies it to the session
 * so the buyer sees the discount already on the checkout page (used by
 * the exit-intent modal). Invalid / expired codes are silently ignored —
 * the checkout still works at full price.
 */
export async function POST(request: Request) {
  const priceId = process.env.STRIPE_FOUNDERS_PRICE_ID;
  if (!priceId) {
    return NextResponse.json(
      { error: "STRIPE_FOUNDERS_PRICE_ID is not configured" },
      { status: 503 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_APP_URL is not configured" },
      { status: 503 },
    );
  }

  // Read current wave for metadata. Falls back to wave 1 if the doc isn't
  // present yet — purchase still goes through.
  let currentWave: 1 | 2 | 3 = 1;
  try {
    const snap = await getAdminDb().doc("appConfig/foundersCohort").get();
    if (snap.exists) {
      const data = snap.data();
      const w = data?.currentWave;
      if (w === 2 || w === 3) currentWave = w;
    }
  } catch (err) {
    console.error("Failed to read founders cohort doc", err);
  }

  // Affiliate attribution: read the ?ref= cookie set by <RefTracker /> and
  // stamp it onto the session metadata so the webhook can credit the right
  // affiliate on purchase. Only on the UGotLeads-branded variant; buyer
  // clones never set this cookie.
  const metadata: Record<string, string> = {
    kind: "founders",
    wave: String(currentWave),
  };
  if (LANDING_VARIANT === "leadstack") {
    try {
      const cookieStore = await cookies();
      const refCode = cookieStore.get(REF_COOKIE_NAME)?.value?.trim();
      if (refCode) metadata.ref = refCode.slice(0, 64);
    } catch {
      // Cookie read can throw in edge runtimes; non-fatal.
    }
  }

  // Optional auto-apply discount code from the request body (e.g. the
  // exit-intent modal passes "GETLEADSTACK"). We look up the matching
  // promotion code in Stripe; if it's missing or inactive we silently
  // drop it so the checkout still loads at full price.
  let discountPromotionCodeId: string | null = null;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      discountCode?: string | null;
    };
    const raw = body.discountCode?.trim().slice(0, 64);
    if (raw) {
      const stripe = getStripeServer();
      const found = await stripe.promotionCodes.list({
        code: raw,
        active: true,
        limit: 1,
      });
      const match = found.data[0];
      if (match) {
        discountPromotionCodeId = match.id;
        metadata.discountCode = raw;
      } else {
        console.log(
          `[founders/checkout] Unknown or inactive promo code "${raw}" — dropping silently`,
        );
      }
    }
  } catch (err) {
    console.error("[founders/checkout] Discount lookup failed", err);
    // Non-fatal — proceed without the discount.
  }

  try {
    const stripe = getStripeServer();

    // Stripe disallows `allow_promotion_codes` when `discounts` is set
    // (Stripe error: "You may not specify both"). When we pre-apply, drop
    // the manual entry field — the buyer doesn't need it since the code
    // is already on the session.
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/#pricing`,
      metadata,
    };
    if (discountPromotionCodeId) {
      sessionParams.discounts = [
        { promotion_code: discountPromotionCodeId },
      ];
    } else {
      sessionParams.allow_promotion_codes = true;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe did not return a checkout URL" },
        { status: 500 },
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Founders checkout failed", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
