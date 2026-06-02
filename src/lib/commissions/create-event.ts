/**
 * src/lib/commissions/create-event.ts
 *
 * Server-side helper that creates a commission_events doc for a completed
 * payment. This is the single entry point for commission creation; it is
 * intentionally kept disabled by default via the PARTNER_COMMISSIONS_ENABLED
 * environment flag and is NOT wired to any live payment flow yet.
 *
 * ── Enable ────────────────────────────────────────────────────────────────
 * Set PARTNER_COMMISSIONS_ENABLED=true in your environment to allow this
 * function to write to Firestore. When the flag is absent or false every
 * call returns { skipped: true } without touching the database.
 *
 * ── Idempotency ───────────────────────────────────────────────────────────
 * The Firestore doc ID is deterministic:
 *   `${stripeEventId}_${partnerProfileId}` (when stripeEventId is provided)
 *   `${paymentEventId}_${partnerProfileId}` (generic fallback)
 * This means re-delivering the same Stripe event never creates a duplicate.
 * .create() throws ALREADY_EXISTS (code 6) on a duplicate, which is swallowed.
 *
 * ── What is NOT in scope ──────────────────────────────────────────────────
 * - No MLM, genealogy, binary, unilevel, downline math, or compensation plan
 *   logic of any kind.
 * - No referral-based event creation (see signup route for referral capture).
 * - No live Stripe activation (caller must gate on PARTNER_COMMISSIONS_ENABLED).
 */

import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import type { CommissionEvent } from "@/types/credits";
import type { PartnerStatus } from "@/types/partner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateCommissionEventInput {
  /** Top-level tenant. Must match the agencyId on partner + product docs. */
  agencyId: string;
  /** partner_profiles/{id} doc id. */
  partnerProfileId: string;
  /** Firebase uid of the customer who made the purchase. */
  customerUserId: string;
  /** subAccounts/{id} the customer operates, if known. */
  customerSubAccountId: string | null;
  /** products/{id} that was sold. */
  productId: string;
  /**
   * Stripe event id (e.g. "evt_…") for Stripe-originated payments.
   * Used as the primary idempotency key. Provide at least one of
   * stripeEventId or paymentEventId.
   */
  stripeEventId: string | null;
  /**
   * Generic payment event id for non-Stripe payment systems.
   * Ignored when stripeEventId is provided.
   */
  paymentEventId: string | null;
  /** Gross sale amount in US cents (before commission). */
  saleAmountCents: number;
  /** Calculated commission amount in US cents. */
  commissionAmountCents: number;
  /** Whole-number commission percentage (1–100). */
  commissionPercent: number;
  /**
   * commission_rules/{id} that was applied to calculate this commission.
   * Null if the caller computed the amount outside the rules system.
   */
  commissionRuleId: string | null;
  /**
   * Optional hold window — don't pay out before this timestamp.
   * Use to enforce a refund window (e.g. 30 days after sale).
   */
  holdUntil: Date | null;
  /** Arbitrary metadata for auditing (not stored in Firestore directly). */
  metadata?: Record<string, string | number | boolean | null>;
}

export type CreateCommissionEventResult =
  | { ok: true; eventId: string }
  | { skipped: true; reason: string }
  | { error: true; message: string };

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const ACTIVE_PARTNER_STATUSES: PartnerStatus[] = ["active", "approved"];

// ---------------------------------------------------------------------------
// Main helper
// ---------------------------------------------------------------------------

/**
 * Creates a commission_events doc after validating all preconditions.
 *
 * Returns:
 *   { ok: true, eventId }      — event created
 *   { skipped: true, reason }  — env flag off OR duplicate OR validation fail
 *   { error: true, message }   — unexpected Firestore error
 */
export async function createCommissionEventForPayment(
  input: CreateCommissionEventInput,
): Promise<CreateCommissionEventResult> {
  // ── Guard: env flag ────────────────────────────────────────────────────
  if (process.env.PARTNER_COMMISSIONS_ENABLED !== "true") {
    console.info("[commissions] PARTNER_COMMISSIONS_ENABLED is not set — skipping commission event creation.");
    return { skipped: true, reason: "PARTNER_COMMISSIONS_ENABLED is not set" };
  }

  const {
    agencyId,
    partnerProfileId,
    productId,
    stripeEventId,
    paymentEventId,
    saleAmountCents,
    commissionAmountCents,
    commissionPercent,
    commissionRuleId,
    holdUntil,
  } = input;

  // ── Derive idempotency key ──────────────────────────────────────────────
  const paymentKey = stripeEventId ?? paymentEventId;
  if (!paymentKey) {
    return { error: true, message: "Either stripeEventId or paymentEventId is required." };
  }
  const eventDocId = `${paymentKey}_${partnerProfileId}`;

  const db = getAdminDb();

  // ── Guard: duplicate check ─────────────────────────────────────────────
  // We also rely on .create() below for atomic idempotency, but doing a
  // fast read first gives a cleaner log message.
  const existingSnap = await db.doc(`commission_events/${eventDocId}`).get().catch(() => null);
  if (existingSnap?.exists) {
    console.info(`[commissions] Duplicate — commission_events/${eventDocId} already exists.`);
    return { skipped: true, reason: `Duplicate event id ${eventDocId}` };
  }

  // ── Validate: product exists ───────────────────────────────────────────
  const productSnap = await db.doc(`products/${productId}`).get().catch(() => null);
  if (!productSnap || !productSnap.exists) {
    console.warn(`[commissions] Product ${productId} not found — skipping.`);
    return { skipped: true, reason: `Product ${productId} not found` };
  }
  const product = productSnap.data() as {
    agencyId: string;
    status: string;
    isPublic: boolean;
    /** Undefined on pre-existing docs — treat as true for backward compat. */
    isCommissionable?: boolean;
  };
  if (product.agencyId !== agencyId) {
    return { skipped: true, reason: `Product ${productId} does not belong to agency ${agencyId}` };
  }
  if (product.status === "archived") {
    return { skipped: true, reason: `Product ${productId} is archived` };
  }

  // ── Guard: product-level commission opt-out ────────────────────────────
  // isCommissionable === false explicitly disables commission creation for this
  // product regardless of rules. Undefined is treated as true for backward
  // compatibility with docs written before Phase 12 added this field.
  if (product.isCommissionable === false) {
    console.info(`[commissions] Product ${productId} has isCommissionable=false — skipping commission event creation.`);
    return { skipped: true, reason: `Product ${productId} is not commissionable` };
  }

  // ── Validate: product is commissionable ────────────────────────────────
  // A product is commissionable when at least one active CommissionRule covers
  // it (productId matches or productId is null = all products).
  const ruleQuery = await db
    .collection("commission_rules")
    .where("agencyId", "==", agencyId)
    .where("isActive", "==", true)
    .get()
    .catch(() => null);

  const applicableRules = ruleQuery?.docs.filter((d) => {
    const data = d.data() as { productId: string | null };
    return data.productId === productId || data.productId === null;
  }) ?? [];

  if (applicableRules.length === 0) {
    console.warn(`[commissions] No active commission rule covers product ${productId} — skipping.`);
    return { skipped: true, reason: `No active commission rule covers product ${productId}` };
  }

  // If a specific ruleId was supplied, verify it's in the applicable set.
  if (commissionRuleId) {
    const ruleMatch = applicableRules.find((d) => d.id === commissionRuleId);
    if (!ruleMatch) {
      console.warn(`[commissions] CommissionRule ${commissionRuleId} not found or inactive — skipping.`);
      return { skipped: true, reason: `CommissionRule ${commissionRuleId} not found or inactive` };
    }
  }

  // Use the provided ruleId or fall back to the first applicable rule.
  const resolvedRuleId = commissionRuleId ?? applicableRules[0].id;

  // ── Validate: partner exists and is active/approved ────────────────────
  const partnerSnap = await db.doc(`partner_profiles/${partnerProfileId}`).get().catch(() => null);
  if (!partnerSnap || !partnerSnap.exists) {
    console.warn(`[commissions] PartnerProfile ${partnerProfileId} not found — skipping.`);
    return { skipped: true, reason: `PartnerProfile ${partnerProfileId} not found` };
  }
  const partner = partnerSnap.data() as { agencyId: string; status: PartnerStatus };
  if (partner.agencyId !== agencyId) {
    return { skipped: true, reason: `Partner ${partnerProfileId} does not belong to agency ${agencyId}` };
  }
  if (!ACTIVE_PARTNER_STATUSES.includes(partner.status)) {
    console.warn(`[commissions] Partner ${partnerProfileId} status is "${partner.status}" — not eligible for commissions.`);
    return { skipped: true, reason: `Partner status "${partner.status}" is not eligible` };
  }

  // ── Validate: product eligibility ─────────────────────────────────────
  // product_eligibility doc id is `${partnerProfileId}_${productId}` per spec.
  const eligibilityId = `${partnerProfileId}_${productId}`;
  const eligibilitySnap = await db.doc(`product_eligibility/${eligibilityId}`).get().catch(() => null);
  if (!eligibilitySnap || !eligibilitySnap.exists) {
    console.warn(`[commissions] No product_eligibility record for ${eligibilityId} — skipping.`);
    return { skipped: true, reason: `No product_eligibility record for ${eligibilityId}` };
  }
  const eligibility = eligibilitySnap.data() as { status: string };
  if (eligibility.status !== "approved") {
    console.warn(`[commissions] Product eligibility ${eligibilityId} status is "${eligibility.status}" — skipping.`);
    return { skipped: true, reason: `Product eligibility status "${eligibility.status}" is not approved` };
  }

  // ── Write commission event (idempotent via .create()) ──────────────────
  const now = FieldValue.serverTimestamp();

  const eventPayload: Omit<CommissionEvent, "id"> = {
    agencyId,
    partnerProfileId,
    commissionRuleId: resolvedRuleId,
    trigger: "product_sale",
    grossAmountCents: saleAmountCents,
    commissionCents: commissionAmountCents,
    commissionPct: commissionPercent,
    status: "pending",
    partnerReferralId: null,
    stripeEventId: stripeEventId ?? null,
    // holdUntil is a future timestamp — convert to Admin Firestore Timestamp
    // so the type matches CommissionEvent. Never use serverTimestamp() for
    // future dates; serverTimestamp() only represents "now" on the server.
    holdUntil: holdUntil ? Timestamp.fromDate(holdUntil) : null,
    paidOutAt: null,
    paidOutNote: null,
    voidedAt: null,
    voidReason: null,
    createdAt: now,
    updatedAt: now,
  };

  const writePayload = eventPayload;

  try {
    // .create() throws ALREADY_EXISTS (code 6) on duplicate — swallow it.
    await db.doc(`commission_events/${eventDocId}`).create(writePayload);

    // Best-effort: increment lifetimeCommissionCents + pendingCommissionCents.
    db.doc(`partner_profiles/${partnerProfileId}`).update({
      lifetimeCommissionCents: FieldValue.increment(commissionAmountCents),
      pendingCommissionCents: FieldValue.increment(commissionAmountCents),
      updatedAt: now,
    }).catch((err) => {
      console.error(`[commissions] Failed to update partner totals for ${partnerProfileId}:`, err);
    });

    console.info(`[commissions] Created commission_events/${eventDocId} — ${commissionAmountCents} cents for partner ${partnerProfileId}`);
    return { ok: true, eventId: eventDocId };
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 6) {
      // ALREADY_EXISTS — race condition between our pre-check and the write.
      console.info(`[commissions] Race-condition duplicate for ${eventDocId} — skipped.`);
      return { skipped: true, reason: `Duplicate event id ${eventDocId} (race)` };
    }
    const message = err instanceof Error ? err.message : "Firestore write failed";
    console.error(`[commissions] Failed to create commission_events/${eventDocId}:`, err);
    return { error: true, message };
  }
}
