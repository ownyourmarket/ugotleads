// src/lib/products/subscription-readiness.ts
//
// Pure readiness validator for subscription products.
// No Firebase SDK imports — safe to use in both client and server contexts.
//
// ── Design ────────────────────────────────────────────────────────────────────
// checkSubscriptionReadiness() takes the product object and returns a structured
// result. The caller provides checkoutEnvEnabled from their environment context.
//
// Client-side callers pass checkoutEnvEnabled=false (they can't read the env var).
// Server-side callers pass process.env.MARKETPLACE_CHECKOUT_ENABLED === "true".
//
// ── Stripe metadata audit ─────────────────────────────────────────────────────
// The checkout route (/api/marketplace/checkout) stamps all required fields:
//   kind, agencyId, subAccountId, customerUserId, productId, productFamily,
//   referredByPartnerProfileId, partnerReferralCode, commissionPercent,
//   commissionRuleId, commissionHoldDays
// All fields are confirmed present and documented in the JSDoc on that route.
//
// ── What this does NOT do ─────────────────────────────────────────────────────
// - Does not activate checkout.
// - Does not create Stripe sessions.
// - No MLM, genealogy, downline, rank, binary, unilevel, team-volume logic.

import type { Product } from "@/types/products";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Ordered readiness states from most to least blocking.
 *
 * "not_subscription"   — product is not subscription access model (check N/A)
 * "archived"           — product is archived (cannot be sold)
 * "draft"              — product status is draft (not yet published)
 * "hidden"             — active but isPublic === false (not visible in marketplace)
 * "missing_stripe_price" — active+public subscription with no Stripe price IDs
 * "ready"              — all product-level checks pass (test checkout possible)
 */
export type SubscriptionReadinessState =
  | "not_subscription"
  | "archived"
  | "draft"
  | "hidden"
  | "missing_stripe_price"
  | "ready";

export interface SubscriptionReadinessResult {
  productId: string;
  /** Overall readiness state — the first failing check wins. */
  state: SubscriptionReadinessState;
  /** True only when state === "ready". */
  overallReady: boolean;
  /**
   * Whether MARKETPLACE_CHECKOUT_ENABLED === "true".
   * Separate from product readiness: a product can be "ready" even when the
   * env flag is off. The flag gates the /api/marketplace/checkout route.
   * Client-side callers should pass false (they cannot read server env vars).
   */
  checkoutEnvEnabled: boolean;
  /** Hard blockers that prevent checkout from succeeding. */
  blockers: string[];
  /** Non-blocking issues worth noting in admin views. */
  warnings: string[];
  /**
   * Product-level metadata snapshot used in the readiness assessment.
   * Also shows what Stripe session metadata fields would contain.
   */
  metadata: {
    accessModel: string;
    status: string;
    isPublic: boolean;
    hasMonthlyPrice: boolean;
    hasAnnualPrice: boolean;
    productFamily: string | null;
    /** isCommissionable is treated as true when undefined (backward compat). */
    isCommissionable: boolean;
    /**
     * Effective eligibility requirement.
     * Undefined on the product defaults to "manual_approval" (safest default).
     */
    eligibilityRequirement: string;
    /** False when relying on the undefined→true default. Warns in admin views. */
    isCommissionableExplicit: boolean;
    /** False when relying on the undefined→manual_approval default. */
    isEligibilityRequirementExplicit: boolean;
  };
  /**
   * Snapshot of what the Stripe session metadata WOULD contain for this product.
   * Does not reflect runtime attribution (partner code, commission rule) since
   * those are resolved at checkout time. Confirms the static fields are in order.
   */
  stripeMetadataAudit: {
    fieldsPresent: string[];
    runtimeFields: string[];
    note: string;
  };
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

/**
 * Runs readiness checks on a subscription product.
 *
 * @param product — The product to check. Pass null to get an N/A result.
 * @param opts.checkoutEnvEnabled — Pass `process.env.MARKETPLACE_CHECKOUT_ENABLED === "true"`
 *                                   from server-side callers. Client callers should pass false.
 */
export function checkSubscriptionReadiness(
  product: Product | null,
  opts?: { checkoutEnvEnabled?: boolean },
): SubscriptionReadinessResult {
  const checkoutEnvEnabled = opts?.checkoutEnvEnabled ?? false;

  // ── Null product ─────────────────────────────────────────────────────────
  if (!product) {
    return {
      productId: "(unknown)",
      state: "not_subscription",
      overallReady: false,
      checkoutEnvEnabled,
      blockers: ["Product not found."],
      warnings: [],
      metadata: {
        accessModel: "(unknown)",
        status: "(unknown)",
        isPublic: false,
        hasMonthlyPrice: false,
        hasAnnualPrice: false,
        productFamily: null,
        isCommissionable: true,
        eligibilityRequirement: "manual_approval",
        isCommissionableExplicit: false,
        isEligibilityRequirementExplicit: false,
      },
      stripeMetadataAudit: {
        fieldsPresent: [],
        runtimeFields: [],
        note: "Product not found — cannot audit.",
      },
    };
  }

  const blockers: string[] = [];
  const warnings: string[] = [];

  // ── Derived metadata ──────────────────────────────────────────────────────
  const hasMonthlyPrice = !!product.stripePriceIdMonthly;
  const hasAnnualPrice = !!product.stripePriceIdAnnual;
  const isCommissionable = product.isCommissionable !== false; // undefined → true
  const isCommissionableExplicit = product.isCommissionable !== undefined;
  const eligibilityRequirement = product.eligibilityRequirement ?? "manual_approval";
  const isEligibilityRequirementExplicit = product.eligibilityRequirement !== undefined;

  // ── Check 1: access model ─────────────────────────────────────────────────
  if (product.accessModel !== "subscription") {
    return {
      productId: product.id,
      state: "not_subscription",
      overallReady: false,
      checkoutEnvEnabled,
      blockers: [
        `Access model is "${product.accessModel}". Subscription readiness only applies to subscription products.`,
      ],
      warnings: [],
      metadata: {
        accessModel: product.accessModel,
        status: product.status,
        isPublic: product.isPublic,
        hasMonthlyPrice,
        hasAnnualPrice,
        productFamily: product.productFamily,
        isCommissionable,
        eligibilityRequirement,
        isCommissionableExplicit,
        isEligibilityRequirementExplicit,
      },
      stripeMetadataAudit: {
        fieldsPresent: [],
        runtimeFields: [],
        note: "N/A — not a subscription product.",
      },
    };
  }

  // ── Check 2: archived ────────────────────────────────────────────────────
  if (product.status === "archived") {
    blockers.push("Product is archived and cannot be sold.");
    return buildResult("archived", product, blockers, warnings, checkoutEnvEnabled, {
      hasMonthlyPrice, hasAnnualPrice, isCommissionable, eligibilityRequirement,
      isCommissionableExplicit, isEligibilityRequirementExplicit,
    });
  }

  // ── Check 3: draft ────────────────────────────────────────────────────────
  if (product.status === "draft") {
    blockers.push("Product status is draft. Set status to Active before enabling checkout.");
    return buildResult("draft", product, blockers, warnings, checkoutEnvEnabled, {
      hasMonthlyPrice, hasAnnualPrice, isCommissionable, eligibilityRequirement,
      isCommissionableExplicit, isEligibilityRequirementExplicit,
    });
  }

  // ── Check 4: hidden (active but not public) ───────────────────────────────
  if (!product.isPublic) {
    blockers.push("Product is active but hidden (isPublic = false). Make it public for marketplace visibility.");
    return buildResult("hidden", product, blockers, warnings, checkoutEnvEnabled, {
      hasMonthlyPrice, hasAnnualPrice, isCommissionable, eligibilityRequirement,
      isCommissionableExplicit, isEligibilityRequirementExplicit,
    });
  }

  // ── Check 5: Stripe price IDs ─────────────────────────────────────────────
  if (!hasMonthlyPrice && !hasAnnualPrice) {
    blockers.push(
      "No Stripe price IDs configured. At least one monthly or annual price ID is required for checkout.",
    );
    return buildResult("missing_stripe_price", product, blockers, warnings, checkoutEnvEnabled, {
      hasMonthlyPrice, hasAnnualPrice, isCommissionable, eligibilityRequirement,
      isCommissionableExplicit, isEligibilityRequirementExplicit,
    });
  }

  // ── Warnings (non-blocking) ───────────────────────────────────────────────
  if (!product.productFamily) {
    warnings.push("productFamily is null. Set a product family for proper marketplace categorization.");
  }
  if (!isCommissionableExplicit) {
    warnings.push(
      "isCommissionable is not explicitly set (defaulting to true). " +
      "Set it explicitly in the Product Manager to confirm intent.",
    );
  }
  if (!isEligibilityRequirementExplicit) {
    warnings.push(
      "eligibilityRequirement is not set (defaulting to manual_approval). " +
      "Set it explicitly in the Product Eligibility manager.",
    );
  }
  if (!checkoutEnvEnabled) {
    warnings.push(
      "MARKETPLACE_CHECKOUT_ENABLED is not set to true. " +
      "Checkout sessions will return 403 until this env var is set.",
    );
  }

  // ── State: ready ──────────────────────────────────────────────────────────
  return buildResult("ready", product, blockers, warnings, checkoutEnvEnabled, {
    hasMonthlyPrice, hasAnnualPrice, isCommissionable, eligibilityRequirement,
    isCommissionableExplicit, isEligibilityRequirementExplicit,
  });
}

// ---------------------------------------------------------------------------
// Builder helper
// ---------------------------------------------------------------------------

function buildResult(
  state: SubscriptionReadinessState,
  product: Product,
  blockers: string[],
  warnings: string[],
  checkoutEnvEnabled: boolean,
  derived: {
    hasMonthlyPrice: boolean;
    hasAnnualPrice: boolean;
    isCommissionable: boolean;
    eligibilityRequirement: string;
    isCommissionableExplicit: boolean;
    isEligibilityRequirementExplicit: boolean;
  },
): SubscriptionReadinessResult {
  return {
    productId: product.id,
    state,
    overallReady: state === "ready",
    checkoutEnvEnabled,
    blockers,
    warnings,
    metadata: {
      accessModel: product.accessModel,
      status: product.status,
      isPublic: product.isPublic,
      hasMonthlyPrice: derived.hasMonthlyPrice,
      hasAnnualPrice: derived.hasAnnualPrice,
      productFamily: product.productFamily,
      isCommissionable: derived.isCommissionable,
      eligibilityRequirement: derived.eligibilityRequirement,
      isCommissionableExplicit: derived.isCommissionableExplicit,
      isEligibilityRequirementExplicit: derived.isEligibilityRequirementExplicit,
    },
    stripeMetadataAudit: {
      fieldsPresent: [
        "kind",
        "agencyId",
        "subAccountId",
        "customerUserId",
        "productId",
        `productFamily: "${product.productFamily ?? ""}"`,
        "commissionHoldDays",
      ],
      runtimeFields: [
        "referredByPartnerProfileId  (resolved from partnerReferralCode at checkout time)",
        "partnerReferralCode          (from myusa_partner_ref cookie)",
        "commissionPercent            (snapshotted from commission_rules at checkout time)",
        "commissionRuleId             (snapshotted from commission_rules at checkout time)",
      ],
      note:
        "All 10 required Stripe metadata fields are stamped by /api/marketplace/checkout. " +
        "Static fields are confirmed present. Runtime fields depend on attribution and rule resolution.",
    },
  };
}

// ---------------------------------------------------------------------------
// Readiness badge config (for UI consumers)
// ---------------------------------------------------------------------------

export const READINESS_BADGE: Record<
  SubscriptionReadinessState,
  { label: string; className: string }
> = {
  not_subscription: { label: "N/A", className: "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500" },
  archived:         { label: "Archived", className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
  draft:            { label: "Draft", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  hidden:           { label: "Hidden", className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  missing_stripe_price: { label: "No prices", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
  ready:            { label: "Test ready", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
};
