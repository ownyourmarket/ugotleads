// src/types/credits.ts
import type { Timestamp, FieldValue } from "firebase/firestore";
import type { PartnerTier } from "./partner";

// ---------------------------------------------------------------------------
// Credit wallets
// ---------------------------------------------------------------------------

/**
 * One wallet per partner. Doc id === partnerProfileId.
 * Collection: credit_wallets/{partnerProfileId}
 */
export interface CreditWallet {
  id: string;                      // === partnerProfileId
  agencyId: string;
  partnerProfileId: string;
  /** The sub-account this wallet funds — mirrors PartnerProfile.subAccountId. */
  subAccountId: string | null;
  balanceCredits: number;          // never below 0
  lifetimePurchasedCredits: number;
  lifetimeSpentCredits: number;
  lifetimeRefundedCredits: number;
  stripeCustomerId: string | null;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

export type CreditTxnType =
  | "purchase"     // operator bought credits
  | "spend"        // deducted for AI run or product usage
  | "refund"       // returned (e.g. failed AI run)
  | "adjustment"   // manual admin correction
  | "expiry";      // time-limited batch expired (v2)

/**
 * Every balance change is recorded here. Append-only.
 * Collection: credit_transactions/{id}
 */
export interface CreditTransaction {
  id: string;
  agencyId: string;
  walletId: string;                // credit_wallets doc id === partnerProfileId
  partnerProfileId: string;
  /** Positive = credits added; negative = credits removed. */
  delta: number;
  type: CreditTxnType;
  /** Balance after this transaction — denormalized for audit trail. */
  balanceAfter: number;
  description: string;
  referenceId: string | null;
  referenceType: "ai_run" | "stripe_event" | "admin_approval" | null;
  createdByUid: string | null;     // null for system-generated
  createdAt: Timestamp | FieldValue | null;
}

// ---------------------------------------------------------------------------
// Commission rules
// ---------------------------------------------------------------------------

export type CommissionTrigger =
  | "partner_referral"
  | "product_sale"
  | "subscription_renewal";

/**
 * Configures what percentage of a sale is credited as commission.
 * Collection: commission_rules/{id}
 */
export interface CommissionRule {
  id: string;
  agencyId: string;
  name: string;
  trigger: CommissionTrigger;
  /** Whole-number percentage, 1–100. */
  commissionPct: number;
  /** Null = applies to all products. */
  productId: string | null;
  /** Null = applies to all tiers. */
  partnerTier: PartnerTier | null;
  isActive: boolean;
  createdByUid: string;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

// ---------------------------------------------------------------------------
// Commission events
// ---------------------------------------------------------------------------

export type CommissionStatus = "pending" | "paid" | "voided";

/**
 * One row per commission earned. Append-only; status flows pending → paid | voided.
 *
 * NOTE: This is a separate system from the LeadStack founders-cohort
 * `referrals` collection (gated on LANDING_VARIANT === "leadstack").
 * Collection: commission_events/{id}
 */
export interface CommissionEvent {
  id: string;
  agencyId: string;
  partnerProfileId: string;
  commissionRuleId: string;
  trigger: CommissionTrigger;
  grossAmountCents: number;
  commissionCents: number;
  /** Snapshotted from the rule at event time — survives rule edits. */
  commissionPct: number;
  status: CommissionStatus;
  partnerReferralId: string | null;
  stripeEventId: string | null;
  paidOutAt: Timestamp | FieldValue | null;
  paidOutNote: string | null;
  voidedAt: Timestamp | FieldValue | null;
  voidReason: string | null;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

// ---------------------------------------------------------------------------
// Partner referrals
// ---------------------------------------------------------------------------

export type PartnerReferralStatus = "pending" | "converted" | "voided";

/**
 * Tracks when a partner refers a new operator who signs up.
 *
 * Collection: partner_referrals/{id}
 *
 * Naming note: the existing `referrals` collection is the LeadStack
 * founders-cohort affiliate program (LANDING_VARIANT === "leadstack" only).
 * This is a different collection with a different purpose.
 */
export interface PartnerReferral {
  id: string;
  agencyId: string;
  referrerPartnerProfileId: string;
  referrerCode: string;            // denormalized for analytics
  refereeEmail: string;
  refereeUid: string | null;       // null until they sign up
  refereePartnerProfileId: string | null; // null until approved
  /** subAccounts/{id} created for the referee at signup. Null until signup completes. */
  refereedSubAccountId: string | null;
  status: PartnerReferralStatus;
  commissionEventId: string | null;
  convertedAt: Timestamp | FieldValue | null;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}
