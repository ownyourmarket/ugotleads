import type Stripe from "stripe";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { sendFoundersWelcomeEmail } from "@/lib/stripe/welcome-email";
import { LANDING_VARIANT } from "@/config/landing";
import { ensureAffiliateAccount } from "@/lib/affiliate/account";
import { createReferral } from "@/lib/affiliate/referrals";
import type { SubscriptionStatus } from "@/types";

export async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
) {
  // Founders cohort: anonymous one-time purchase. No uid in metadata
  // (buyer hasn't signed up yet — we email them within 24h to onboard).
  // Branch on `metadata.kind` so we don't break legacy subscription flow.
  if (session.metadata?.kind === "founders") {
    await handleFoundersCheckout(session);
    return;
  }

  // Self-serve subscription — anonymous-at-checkout. The buyer pays
  // before signing up; we stash a pendingSignups doc keyed by session id
  // so the signup route can mint their agency when they create the
  // Firebase auth account on the success page.
  if (session.metadata?.kind === "self_serve_subscription") {
    await handleSelfServeSubscription(session);
    return;
  }

  // Legacy subscription flow — requires uid stamped at checkout creation.
  const uid = session.metadata?.uid;
  if (!uid) {
    console.error("No uid found in checkout session metadata");
    return;
  }

  await getAdminDb().collection("users").doc(uid).update({
    stripeCustomerId: session.customer as string,
    subscriptionStatus: "active" as SubscriptionStatus,
    subscriptionPriceId: session.metadata?.priceId ?? null,
    updatedAt: new Date(),
  });
}

async function handleSelfServeSubscription(
  session: Stripe.Checkout.Session,
) {
  const sessionId = session.id;
  const email = (
    session.customer_details?.email ?? session.customer_email ?? ""
  )
    .trim()
    .toLowerCase();
  if (!email) {
    console.error(
      `[self-serve] Session ${sessionId} completed without a buyer email — can't provision`,
    );
    return;
  }
  const priceId = session.metadata?.priceId ?? null;
  const customerId =
    typeof session.customer === "string" ? session.customer : null;
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : null;

  const db = getAdminDb();
  try {
    // Use .create() for natural idempotency on Stripe retries — second
    // delivery throws ALREADY_EXISTS (Firestore code 6) which we swallow.
    await db.doc(`pendingSignups/${sessionId}`).create({
      sessionId,
      email,
      priceId,
      customerId,
      subscriptionId,
      kind: "self_serve_subscription",
      createdAt: new Date(),
    });
    console.info(
      `[self-serve] pendingSignups/${sessionId} created for ${email} (price ${priceId})`,
    );
  } catch (err) {
    // 6 = ALREADY_EXISTS — duplicate webhook delivery, normal.
    const code = (err as { code?: number }).code;
    if (code === 6) {
      console.info(`[self-serve] duplicate webhook for ${sessionId} — skipped`);
      return;
    }
    console.error(`[self-serve] pendingSignups write failed for ${sessionId}:`, err);
  }
}

async function handleFoundersCheckout(session: Stripe.Checkout.Session) {
  const sessionId = session.id;
  const email = session.customer_details?.email ?? session.customer_email;
  if (!email) {
    console.error(
      `[founders] Session ${sessionId} completed without a buyer email — cannot send welcome`,
    );
    return;
  }

  const waveRaw = session.metadata?.wave;
  const wave: 1 | 2 | 3 =
    waveRaw === "2" ? 2 : waveRaw === "3" ? 3 : 1;
  const amountPaidCents =
    typeof session.amount_total === "number" ? session.amount_total : null;
  const refCode = session.metadata?.ref ?? null;

  // Idempotency: Stripe retries webhooks on any non-2xx response, and even
  // on success duplicates can land via dashboard "Resend" or webhook
  // endpoint reconfiguration. The purchases/{sessionId} doc is created
  // atomically; if it already exists we skip the rest of the flow.
  const purchaseRef = getAdminDb().collection("purchases").doc(sessionId);
  try {
    await purchaseRef.create({
      sessionId,
      kind: "founders",
      email,
      wave,
      amountPaidCents,
      stripeCustomerId: (session.customer as string | null) ?? null,
      refCode,
      welcomeEmailSentAt: null,
      welcomeEmailMessageId: null,
      buyerAffiliateCode: null,
      referralCredited: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // .create() throws 6 ALREADY_EXISTS when the doc is present — that's
    // the duplicate-webhook case. Any other error gets re-raised so the
    // route returns 500 and Stripe retries with a clean slate.
    const code = (err as { code?: number })?.code;
    if (code === 6) {
      console.log(
        `[founders] Skipping duplicate webhook for session ${sessionId}`,
      );
      return;
    }
    throw err;
  }

  // Affiliate program — only runs on the LeadStack-branded variant. Buyer
  // clones (LANDING_VARIANT === "custom") skip this whole block; their
  // welcome email goes out without affiliate copy and no Firestore writes
  // hit the affiliates/referrals collections.
  let buyerAffiliateCode: string | null = null;
  let referralOutcome: string | null = null;
  if (LANDING_VARIANT === "leadstack") {
    try {
      const buyerAffiliate = await ensureAffiliateAccount({
        email,
        displayName: session.customer_details?.name ?? null,
      });
      buyerAffiliateCode = buyerAffiliate.code;

      if (refCode) {
        const outcome = await createReferral({
          refCode,
          purchaseSessionId: sessionId,
          buyerEmail: email,
          amountPaidCents,
        });
        referralOutcome =
          outcome.status === "credited"
            ? `credited:${outcome.commissionCents}`
            : `skipped:${outcome.reason}`;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[founders] Affiliate flow failed for ${sessionId}: ${message}`);
      // Non-fatal — we still send the welcome email + record the purchase.
    }
  }

  const messageId = await sendFoundersWelcomeEmail({
    to: email,
    affiliateCode: buyerAffiliateCode,
  });

  await purchaseRef.update({
    welcomeEmailSentAt: messageId
      ? FieldValue.serverTimestamp()
      : null,
    welcomeEmailMessageId: messageId,
    buyerAffiliateCode,
    referralCredited: referralOutcome,
  });
}

export async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
) {
  const customerId = subscription.customer as string;
  const db = getAdminDb();

  const usersSnapshot = await db
    .collection("users")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get();

  if (usersSnapshot.empty) {
    console.error(`No user found for Stripe customer ${customerId}`);
    return;
  }

  const userDoc = usersSnapshot.docs[0];
  const newPriceId = subscription.items?.data?.[0]?.price?.id ?? null;
  await userDoc.ref.update({
    subscriptionStatus: subscription.status as SubscriptionStatus,
    subscriptionPriceId: newPriceId,
    updatedAt: new Date(),
  });

  // Refresh AI usage cap on tier change. Best-effort — never throws.
  // Maps Stripe price id -> token cap (matches docs/ai-provider-billing-spec.md).
  // Today's env model has only STRIPE_PRO_PRICE_ID ($197 Local Pro) +
  // STRIPE_FOUNDERS_PRICE_ID. As we ship the $297 + $497 SKUs we'll add
  // STRIPE_MULTI_SERVICE_PRICE_ID and STRIPE_TERRITORY_PARTNER_PRICE_ID.
  const priceCapMap: Record<string, number> = {};
  if (process.env.STRIPE_PRO_PRICE_ID) priceCapMap[process.env.STRIPE_PRO_PRICE_ID] = 1_000_000;
  if (process.env.STRIPE_MULTI_SERVICE_PRICE_ID)
    priceCapMap[process.env.STRIPE_MULTI_SERVICE_PRICE_ID] = 5_000_000;
  if (process.env.STRIPE_TERRITORY_PARTNER_PRICE_ID)
    priceCapMap[process.env.STRIPE_TERRITORY_PARTNER_PRICE_ID] = 15_000_000;

  const newCap = newPriceId ? priceCapMap[newPriceId] : undefined;
  if (newCap == null) {
    if (newPriceId)
      console.warn(
        `[stripe/sub-updated] price ${newPriceId} not in cap map — skipping cap refresh`,
      );
    return;
  }

  const userData = userDoc.data();
  const agencyId = userData?.primaryAgencyId;
  if (!agencyId) {
    console.warn(
      `[stripe/sub-updated] user ${userDoc.id} has no primaryAgencyId — can't refresh sub-account caps`,
    );
    return;
  }

  try {
    const subAccountsSnap = await db
      .collection("subAccounts")
      .where("agencyId", "==", agencyId)
      .get();
    const writes: Promise<unknown>[] = [];
    for (const saDoc of subAccountsSnap.docs) {
      writes.push(
        saDoc.ref.set(
          { aiUsage: { monthlyCapTokens: newCap } },
          { merge: true },
        ),
      );
    }
    await Promise.all(writes);
    console.info(
      `[stripe/sub-updated] refreshed ${subAccountsSnap.size} sub-accounts to cap=${newCap} for agency=${agencyId}`,
    );
  } catch (err) {
    console.error(
      `[stripe/sub-updated] cap refresh failed for agency=${agencyId}:`,
      err,
    );
  }
}

export async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
) {
  const customerId = subscription.customer as string;

  const usersSnapshot = await getAdminDb()
    .collection("users")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get();

  if (usersSnapshot.empty) {
    console.error(`No user found for Stripe customer ${customerId}`);
    return;
  }

  const userDoc = usersSnapshot.docs[0];
  await userDoc.ref.update({
    subscriptionStatus: "inactive" as SubscriptionStatus,
    updatedAt: new Date(),
  });
}
