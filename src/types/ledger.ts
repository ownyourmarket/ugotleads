// src/types/ledger.ts
import type { Timestamp, FieldValue } from "firebase/firestore";
import type { AccessModel } from "./products";

// ---------------------------------------------------------------------------
// Living ledger
// ---------------------------------------------------------------------------

export type LedgerLineType =
  | "credit_purchase"
  | "credit_spend"
  | "commission_earned"
  | "commission_paid"
  | "subscription_charge"
  | "refund"
  | "adjustment";

export interface LedgerLine {
  type: LedgerLineType;
  /** Positive = inflow, negative = outflow. Cents. */
  amountCents: number;
  description: string;
  /** ISO 8601 — stored as string for cheap deserialization. */
  occurredAt: string;
  referenceId: string | null;
}

/**
 * Rolling monthly financial snapshot per partner.
 * Doc id = `${partnerProfileId}_${periodKey}` where periodKey = "YYYY-MM".
 * Lines are appended in place; running totals are updated on each append.
 * Never update historical period docs — only the current period is live.
 * Collection: living_ledger/{id}
 */
export interface LivingLedger {
  id: string;                      // `${partnerProfileId}_${periodKey}`
  agencyId: string;
  partnerProfileId: string;
  periodKey: string;               // "YYYY-MM"
  lines: LedgerLine[];
  totalInCents: number;
  totalOutCents: number;
  netCents: number;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

// ---------------------------------------------------------------------------
// Admin approvals
// ---------------------------------------------------------------------------

export type ApprovalType =
  | "partner_application"
  | "credit_adjustment"
  | "commission_dispute"
  | "byok_activation"
  | "product_access";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

/**
 * Queue of actions requiring agency-owner sign-off.
 * Collection: admin_approvals/{id}
 */
export interface AdminApproval {
  id: string;
  agencyId: string;
  type: ApprovalType;
  status: ApprovalStatus;
  subjectId: string;
  subjectType:
    | "partner_profile"
    | "commission_event"
    | "credit_wallet"
    | "product_eligibility";
  summary: string;
  details: string | null;
  requestedByUid: string | null;   // null = system-initiated
  requestedAt: Timestamp | FieldValue | null;
  reviewedByUid: string | null;
  reviewedAt: Timestamp | FieldValue | null;
  reviewNote: string | null;
  expiresAt: Timestamp | FieldValue | null;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

// ---------------------------------------------------------------------------
// Stripe events cache
// ---------------------------------------------------------------------------

export type StripeEventStatus = "received" | "processed" | "failed" | "ignored";

/**
 * Idempotent cache of processed Stripe webhook events.
 * Doc id === Stripe event id (evt_…) — natural dedup on retries.
 * Collection: stripe_events/{stripeEventId}
 */
export interface StripeEvent {
  id: string;
  agencyId: string;
  stripeEventType: string;         // e.g. "checkout.session.completed"
  status: StripeEventStatus;
  objectType: string;              // e.g. "checkout.session"
  objectId: string;
  customerEmail: string | null;
  amountCents: number | null;
  handledBy: string | null;
  outcome: string | null;
  errorMessage: string | null;
  receivedAt: Timestamp | FieldValue | null;
  processedAt: Timestamp | FieldValue | null;
  createdAt: Timestamp | FieldValue | null;
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export type CampaignType =
  | "email_sequence"
  | "sms_blast"
  | "social"
  | "paid_ad"
  | "outreach"
  | "other";

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "active"
  | "paused"
  | "completed"
  | "archived";

export interface CampaignMetrics {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  converted: number;
  leads: number;
}

/**
 * A marketing or outreach campaign run by the agency or a partner.
 * Scoped to a sub-account (the existing workspace doc).
 * Collection: campaigns/{id}
 */
export interface Campaign {
  id: string;
  agencyId: string;
  subAccountId: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  description: string | null;
  productId: string | null;
  startDate: string | null;        // ISO 8601 date
  endDate: string | null;
  budgetCents: number;
  spentCents: number;
  metrics: CampaignMetrics;
  createdByUid: string;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

// ---------------------------------------------------------------------------
// AI runs
// ---------------------------------------------------------------------------

export type AiRunStatus = "pending" | "success" | "failed" | "timeout";

export type AiRunChannel =
  | "web_chat"
  | "sms"
  | "email"
  | "marketing_copy"
  | "compliance_review"
  | "onboarding_guide"
  | "other";

/**
 * One record per discrete AI inference call.
 * Enables per-operator usage accounting regardless of access model.
 * Collection: ai_runs/{id}
 */
export interface AiRun {
  id: string;
  agencyId: string;
  subAccountId: string;
  partnerProfileId: string | null;
  channel: AiRunChannel;
  status: AiRunStatus;
  model: string;                   // OpenRouter model id
  accessModel: AccessModel;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  creditsCharged: number;          // 0 for subscription and byok
  /** Cost in microcents (1/1000 cent) at OpenRouter rates. Agency-internal. */
  costMicrocents: number;
  creditTransactionId: string | null;
  errorMessage: string | null;
  createdAt: Timestamp | FieldValue | null;
}
