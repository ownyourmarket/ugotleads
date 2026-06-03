// src/types/marketplace.ts
import type { Timestamp, FieldValue } from "firebase/firestore";
import type { ProductFamily } from "./products";

/**
 * Stripe checkout session status values.
 * "open"     — session not yet completed
 * "complete" — checkout was completed (payment may still be processing)
 * "expired"  — session expired without completion
 */
export type CheckoutStatus = "open" | "complete" | "expired";

/**
 * Stripe checkout session payment_status values.
 * "paid"                — customer has paid
 * "unpaid"              — no payment collected yet
 * "no_payment_required" — free or trial checkout
 */
export type PaymentStatus = "paid" | "unpaid" | "no_payment_required";

/**
 * A record of one marketplace product purchase, written by the
 * checkout.session.completed Stripe webhook.
 *
 * Doc id: stripeSessionId (deterministic — idempotent on webhook retries)
 * Collection: marketplace_purchases/{stripeSessionId}
 *
 * ── Safety note ───────────────────────────────────────────────────────────────
 * This collection tracks product sales only. It is entirely separate from
 * the `referrals` collection (LeadStack founders affiliate) and the
 * `partner_referrals` collection (new-operator referrals). Do not mix them.
 *
 * ── Commission link ───────────────────────────────────────────────────────────
 * commissionEventId is null until a commission_events doc is created for this
 * purchase (which requires PARTNER_COMMISSIONS_ENABLED=true, a valid attributed
 * partner, and an active commission rule). Purchase records exist independently
 * of whether a commission was created.
 */
export interface MarketplacePurchase {
  id: string;                               // === stripeSessionId
  agencyId: string;
  subAccountId: string;
  customerUserId: string;

  // ── Product snapshot ──────────────────────────────────────────────────────
  productId: string;
  /** Denormalized name at purchase time — survives product renames. */
  productName: string;
  productFamily: ProductFamily | null;

  // ── Stripe session data ───────────────────────────────────────────────────
  stripeSessionId: string;
  /** Null for subscription-mode sessions (payment flows through invoices). */
  stripePaymentIntentId: string | null;
  amountTotalCents: number;
  currency: string;                         // ISO 4217 lowercase, e.g. "usd"
  /** session.status at webhook delivery time. */
  checkoutStatus: CheckoutStatus;
  /** session.payment_status at webhook delivery time. */
  paymentStatus: PaymentStatus;

  // ── Attribution ───────────────────────────────────────────────────────────
  /** partner_profiles/{id} who referred this customer. Null if unattributed. */
  referredByPartnerProfileId: string | null;
  /** Raw referral code for audit. Null if unattributed. */
  partnerReferralCode: string | null;

  // ── Commission link ───────────────────────────────────────────────────────
  /** commission_events/{id} created for this purchase. Null until commission fires. */
  commissionEventId: string | null;

  // ── Fulfillment link (Phase 20) ───────────────────────────────────────────
  /**
   * product_entitlements/{id} granted for this purchase. Null/undefined until
   * fulfillment runs (paid sessions only). Optional on docs written before Phase 20.
   */
  entitlementId?: string | null;
  /** Set when the customer's product entitlement was granted. */
  fulfilledAt?: Timestamp | FieldValue | null;

  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}
