import type Stripe from "stripe";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { sendFoundersWelcomeEmail } from "@/lib/stripe/welcome-email";
import { LANDING_VARIANT } from "@/config/landing";
import { ensureAffiliateAccount } from "@/lib/affiliate/account";
import { createReferral } from "@/lib/affiliate/referrals";
import type { SubscriptionStatus } from "@/types";
// ── Partner commission hook ───────────────────────────────────────────────
// Activated for marketplace_product_purchase checkout sessions (Phase 8).
// Gated by PARTNER_COMMISSIONS_ENABLED=true; safe/no-op by default.
import { createCommissionEventForPayment } from "@/lib/commissions/create-event";
// ── Purchase fulfillment hook (Phase 20) ──────────────────────────────────
// Grants the customer a product_entitlements row when a paid purchase completes.
import { grantProductEntitlement } from "@/lib/fulfillment/grant-entitlement";
import type { AccessModel, ProductFamily } from "@/types/products";

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

  // Marketplace product purchase — authenticated buyer. Attribution metadata
  // was stamped by POST /api/marketplace/checkout. Creates a commission event
  // when PARTNER_COMMISSIONS_ENABLED=true and a partner was attributed.
  if (session.metadata?.kind === "marketplace_product_purchase") {
    await handleMarketplaceProductPurchase(session);
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

  // ── Partner commission hook ──────────────────────────────────────────────
  // STUB — not yet wired to a real product / partner resolution.
  //
  // When PARTNER_COMMISSIONS_ENABLED=true AND this session carries
  // `metadata.partnerProfileId` + `metadata.productId`, this is where we
  // would call createCommissionEventForPayment(). In Phase 5 we only
  // establish the call-site; the metadata stamping and full wiring happen
  // in Phase 6 once checkout flows stamp partner attribution.
  //
  // To activate (Phase 6+):
  //   1. Stamp { partnerProfileId, productId, commissionAmountCents,
  //              commissionPercent } into session.metadata at checkout creation.
  //   2. Uncomment and complete the block below.
  //   3. Set PARTNER_COMMISSIONS_ENABLED=true in the environment.
  //
  // if (
  //   process.env.PARTNER_COMMISSIONS_ENABLED === "true" &&
  //   session.metadata?.partnerProfileId &&
  //   session.metadata?.productId
  // ) {
  //   createCommissionEventForPayment({
  //     agencyId: session.metadata.agencyId ?? "",
  //     partnerProfileId: session.metadata.partnerProfileId,
  //     customerUserId: session.metadata.uid ?? "",
  //     customerSubAccountId: session.metadata.subAccountId ?? null,
  //     productId: session.metadata.productId,
  //     stripeEventId: sessionId,      // checkout session id as idempotency key
  //     paymentEventId: null,
  //     saleAmountCents: session.amount_total ?? 0,
  //     commissionAmountCents: Number(session.metadata.commissionAmountCents ?? 0),
  //     commissionPercent: Number(session.metadata.commissionPercent ?? 0),
  //     commissionRuleId: session.metadata.commissionRuleId ?? null,
  //     holdUntil: null,
  //     metadata: { sessionId },
  //   }).catch((err) =>
  //     console.error("[self-serve] commission hook failed:", err)
  //   );
  // }
}

// ---------------------------------------------------------------------------
// Marketplace product purchase — Phase 8 attribution
// ---------------------------------------------------------------------------

/**
 * Handles checkout.session.completed for kind === "marketplace_product_purchase".
 *
 * Reads the attribution + commission snapshot stamped by POST /api/marketplace/checkout:
 *   - agencyId, subAccountId, customerUserId, productId, productFamily
 *   - referredByPartnerProfileId  ← partner who referred the buyer ("" = none)
 *   - partnerReferralCode         ← raw code for audit
 *   - commissionPercent           ← snapshotted at session creation
 *   - commissionRuleId            ← snapshotted at session creation
 *   - commissionHoldDays          ← hold window for refund period
 *
 * Commission event creation:
 *   Only fires when ALL of:
 *     1. PARTNER_COMMISSIONS_ENABLED=true
 *     2. referredByPartnerProfileId is non-empty
 *     3. commissionPercent > 0
 *   Uses session.amount_total as the gross sale amount and recalculates
 *   commissionAmountCents from the snapshotted commissionPercent so the payout
 *   reflects the actual amount charged (not a sentinel).
 *
 * Idempotency:
 *   paymentEventId = `checkout_${session.id}` — deterministic per Stripe session.
 *   Re-delivering the same webhook returns { skipped } from createCommissionEventForPayment().
 *
 * ── Safety constraints ────────────────────────────────────────────────────────
 * - No MLM, genealogy, binary, unilevel, or downline math.
 * - No PartnerReferral doc created here (that collection tracks new-operator signups).
 * - Does not activate live Stripe commission payouts.
 */
async function handleMarketplaceProductPurchase(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const sessionId = session.id;
  const meta = session.metadata ?? {};

  const agencyId = meta.agencyId ?? "";
  const customerUserId = meta.customerUserId ?? "";
  const productId = meta.productId ?? "";
  const subAccountId = meta.subAccountId ?? "";
  const referredByPartnerProfileId = (meta.referredByPartnerProfileId ?? "").trim();
  const partnerReferralCode = (meta.partnerReferralCode ?? "").trim();
  const commissionPercent = Number(meta.commissionPercent ?? "0");
  const commissionRuleId = meta.commissionRuleId ?? "";
  const holdDays = Number(meta.commissionHoldDays ?? "30");

  if (!agencyId || !productId || !customerUserId) {
    console.error(
      `[marketplace-purchase] Session ${sessionId} missing required metadata — skipping.`,
    );
    return;
  }

  const db = getAdminDb();
  const now = FieldValue.serverTimestamp();
  const saleAmountCents = session.amount_total ?? 0;

  // ── Step 1: fetch product name snapshot ──────────────────────────────────
  // Best-effort — if the product is gone we still record the purchase.
  const productSnap = await db.doc(`products/${productId}`).get().catch(() => null);
  const productName =
    (productSnap?.data() as { name?: string } | undefined)?.name ?? productId;
  const productFamily =
    (productSnap?.data() as { productFamily?: string | null } | undefined)?.productFamily ?? null;

  // ── Step 2: write marketplace_purchases doc (idempotent) ─────────────────
  // Doc id === sessionId so Stripe retries are naturally idempotent.
  // We use .create() which throws ALREADY_EXISTS (code 6) on a duplicate.
  const purchaseRef = db.doc(`marketplace_purchases/${sessionId}`);
  let purchaseAlreadyExisted = false;

  try {
    await purchaseRef.create({
      id: sessionId,
      agencyId,
      subAccountId,
      customerUserId,
      productId,
      productName,
      productFamily: productFamily ?? null,
      stripeSessionId: sessionId,
      stripePaymentIntentId:
        typeof session.payment_intent === "string" ? session.payment_intent : null,
      amountTotalCents: saleAmountCents,
      currency: session.currency ?? "usd",
      checkoutStatus: session.status ?? "complete",
      paymentStatus: session.payment_status ?? "paid",
      referredByPartnerProfileId: referredByPartnerProfileId || null,
      partnerReferralCode: partnerReferralCode || null,
      commissionEventId: null,
      createdAt: now,
      updatedAt: now,
    });
    console.info(`[marketplace-purchase] Purchase recorded: marketplace_purchases/${sessionId}`);
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 6) {
      // ALREADY_EXISTS — duplicate webhook delivery; purchase already recorded.
      purchaseAlreadyExisted = true;
      console.info(
        `[marketplace-purchase] Duplicate webhook for session ${sessionId} — purchase already recorded, checking commission.`,
      );
    } else {
      console.error(
        `[marketplace-purchase] Failed to write marketplace_purchases/${sessionId}:`,
        err,
      );
      // Non-fatal — still attempt commission creation below.
    }
  }

  // ── Step 2.5: fulfillment — grant the customer a product entitlement ──────
  // Runs for EVERY paid purchase, regardless of partner attribution, so it must
  // precede the no-attribution early return below. Idempotent + best-effort:
  // failure here is logged but does not block commission processing.
  const isPaid = (session.payment_status ?? "paid") === "paid";
  if (isPaid) {
    const accessModel =
      ((productSnap?.data() as { accessModel?: AccessModel } | undefined)?.accessModel ??
        "subscription") as AccessModel;

    const fulfill = await grantProductEntitlement({
      agencyId,
      customerUserId,
      productId,
      subAccountId: subAccountId || null,
      productName,
      productFamily: (productFamily ?? null) as ProductFamily | null,
      accessModel,
      grantingSessionId: sessionId,
    });

    if ("ok" in fulfill) {
      console.info(
        `[marketplace-purchase] Entitlement ${fulfill.entitlementId}${fulfill.alreadyActive ? " (already active)" : " granted"} for session ${sessionId}`,
      );
      // Best-effort backfill — failure does not affect the entitlement itself.
      purchaseRef
        .update({
          entitlementId: fulfill.entitlementId,
          fulfilledAt: Timestamp.now(),
          fulfillmentSource: "webhook",
          updatedAt: Timestamp.now(),
        })
        .catch((err) => {
          console.error(
            `[marketplace-purchase] Failed to backfill entitlementId on purchase ${sessionId}:`,
            err,
          );
        });
    } else {
      console.error(
        `[marketplace-purchase] Entitlement grant failed for session ${sessionId}: ${fulfill.message}`,
      );
    }
  } else {
    console.info(
      `[marketplace-purchase] Session ${sessionId} payment_status="${session.payment_status}" — not paid, skipping entitlement grant.`,
    );
  }

  // ── Step 3: commission event ──────────────────────────────────────────────
  // Only create when a partner was attributed and a commission rule was applied.
  // createCommissionEventForPayment() is its own gate (PARTNER_COMMISSIONS_ENABLED).
  if (!referredByPartnerProfileId || commissionPercent <= 0) {
    console.info(
      `[marketplace-purchase] Session ${sessionId} — no partner attribution or zero commission. Purchase recorded${purchaseAlreadyExisted ? " (already existed)" : ""}, no commission event.`,
    );
    return;
  }

  const commissionAmountCents = Math.floor((saleAmountCents * commissionPercent) / 100);
  const holdUntil =
    holdDays > 0
      ? new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000)
      : null;

  const result = await createCommissionEventForPayment({
    agencyId,
    partnerProfileId: referredByPartnerProfileId,
    customerUserId,
    customerSubAccountId: subAccountId || null,
    productId,
    stripeEventId: null,
    paymentEventId: `checkout_${sessionId}`,   // deterministic idempotency key
    saleAmountCents,
    commissionAmountCents,
    commissionPercent,
    commissionRuleId: commissionRuleId || null,
    holdUntil,
    metadata: {
      source: "marketplace_checkout",
      stripeSessionId: sessionId,
      partnerReferralCode,
    },
  });

  if ("ok" in result) {
    console.info(
      `[marketplace-purchase] Commission event created: ${result.eventId} — ${commissionAmountCents}¢ for partner ${referredByPartnerProfileId}`,
    );
    // ── Step 4: attach commissionEventId to purchase record ──────────────
    // Best-effort update — failure here does not affect the commission itself.
    purchaseRef.update({
      commissionEventId: result.eventId,
      updatedAt: Timestamp.now(),
    }).catch((err) => {
      console.error(
        `[marketplace-purchase] Failed to attach commissionEventId to purchase ${sessionId}:`,
        err,
      );
    });
  } else if ("skipped" in result) {
    console.info(
      `[marketplace-purchase] Commission event skipped for session ${sessionId}: ${result.reason}`,
    );
  } else {
    console.error(
      `[marketplace-purchase] Commission event error for session ${sessionId}: ${result.message}`,
    );
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

  // Affiliate program — only runs on the UGotLeads-branded variant. Buyer
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
