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
    subscriptionStatus: subscription.status as SubscriptionStatus,
    updatedAt: new Date(),
  });
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
