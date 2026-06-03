// src/types/products.ts
import type { Timestamp, FieldValue } from "firebase/firestore";

/**
 * The three access models for the Revenue OS.
 * This is the canonical definition — PlanMode in tenancy.ts mirrors it
 * to avoid a circular import.
 */
export type AccessModel = "credit" | "subscription" | "byok";

export type ProductStatus = "draft" | "active" | "archived";

/**
 * The product family a product belongs to.
 * Encodes which brand/entity offers the product and what category it falls under.
 *
 * - ugotleads_software   → AI CRM, Revenue OS features, licensed platform software
 * - myusa_education       → courses, certification programs, training materials
 * - myusa_services        → done-for-you services offered by MyUSA Local
 * - myusa_resources       → templates, playbooks, toolkits, resource packs
 * - myusa_media_products  → magazines, newsletters, directory listings, media assets
 */
export type ProductFamily =
  | "ugotleads_software"
  | "myusa_education"
  | "myusa_services"
  | "myusa_resources"
  | "myusa_media_products";

/**
 * A licensable product or feature offered through the platform.
 * Collection: products/{id}
 */
export interface Product {
  id: string;
  agencyId: string;
  name: string;
  description: string | null;
  status: ProductStatus;
  accessModel: AccessModel;
  /**
   * Which product family this belongs to. Null = ungrouped / legacy.
   * Used to distinguish uGotLeads software products from MyUSA Local
   * education, services, resources, and media products.
   */
  productFamily: ProductFamily | null;
  /**
   * uid or stable identifier of the entity that owns/offers this product.
   * E.g. "myusa_local" for MyUSA Local offerings, or a uid for partner-created
   * products. Null = platform default (agency owner).
   */
  productOwner: string | null;
  /**
   * Origin label or URL. E.g. "myusa_local", "partner_created", or an
   * external URL for products sourced outside the platform.
   */
  productSource: string | null;
  /**
   * Credits charged per unit (credit model only).
   * 0 for subscription and byok products.
   */
  creditCostPerUnit: number;
  /** Stripe monthly Price ID (subscription model only). */
  stripePriceIdMonthly: string | null;
  /** Stripe annual Price ID (subscription model only). */
  stripePriceIdAnnual: string | null;
  /** One-time setup fee in cents. 0 if none. */
  setupFeeCents: number;
  /** Visible in the partner marketplace when true. */
  isPublic: boolean;
  /**
   * Controls what a partner must complete before they can sell / earn from
   * this product. Undefined on pre-existing docs is treated as
   * "manual_approval" (the safest default — approval is never implicit).
   *
   * This field is distinct from product visibility (isPublic). A public product
   * can be viewed and purchased by customers; eligibility controls whether a
   * partner can sell it and earn commission from it.
   */
  eligibilityRequirement?: EligibilityRequirement;
  /**
   * When true, this product participates in the commission system.
   * Commission events are still gated by PARTNER_COMMISSIONS_ENABLED and the
   * existence of a matching commission_rule — this flag is an additional opt-out
   * at the product level. Defaults to true for all access models.
   * Undefined on pre-existing docs should be treated as true.
   */
  isCommissionable?: boolean;
  createdByUid: string;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

export type EligibilityStatus =
  | "pending"   // applied, awaiting approval
  | "approved"  // access granted
  | "denied"    // not approved
  | "revoked";  // was approved, access withdrawn

/**
 * What a partner must complete before they can sell or earn from a product.
 *
 * "none"                          — any active/approved partner can sell
 * "track_certified_ai_consultant" — must have completed the Certified AI Consultant track
 * "track_community_advocate"      — must have completed the Community Advocate track
 * "either_track"                  — either of the two tracks above
 * "both_tracks"                   — both tracks required
 * "manual_approval"               — agency owner must explicitly approve (default)
 *
 * Undefined on existing Product docs is treated as "manual_approval" — the
 * safest default. Approval is never implicit.
 */
export type EligibilityRequirement =
  | "none"
  | "track_certified_ai_consultant"
  | "track_community_advocate"
  | "either_track"
  | "both_tracks"
  | "manual_approval";

/**
 * Records whether a partner is eligible for a product.
 * Doc id is deterministic: `${partnerProfileId}_${productId}`
 * Collection: product_eligibility/{id}
 */
export interface ProductEligibility {
  id: string;                      // `${partnerProfileId}_${productId}`
  agencyId: string;
  partnerProfileId: string;
  productId: string;
  status: EligibilityStatus;
  accessModel: AccessModel;        // denormalized from product
  stripeSubscriptionId: string | null;
  /**
   * True when the partner has a valid BYOK key stored in the server-only
   * `byok_keys` collection. False / undefined when no key is set.
   *
   * This field is safe to store here and read by the client.
   * The actual key lives exclusively in byok_keys/{partnerProfileId}_{productId}
   * which is unreadable from the client SDK.
   */
  byokConfigured?: boolean;
  /**
   * Last 4 characters of the BYOK key — safe display field.
   * Null when no key has been configured or after the key is removed.
   *
   * NOTE: byokKey was removed from this type in Phase 17 security hardening.
   * The full key is now stored server-only in the `byok_keys` collection.
   */
  byokKeyLast4: string | null;
  byokKeyValidatedAt: Timestamp | FieldValue | null;
  reviewedByUid: string | null;
  reviewedAt: Timestamp | FieldValue | null;
  reviewNote: string | null;
  expiresAt: Timestamp | FieldValue | null;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

// ---------------------------------------------------------------------------
// Product entitlements (customer access)
// ---------------------------------------------------------------------------

/**
 * "active"  — customer currently has access to the product
 * "revoked" — access was withdrawn (e.g. refund, subscription cancelled)
 */
export type EntitlementStatus = "active" | "revoked";

/**
 * Records that a CUSTOMER has access to a product after a completed purchase.
 *
 * Doc id is deterministic: `${customerUserId}_${productId}`
 * Collection: product_entitlements/{id}
 *
 * ── Distinct from product_eligibility ─────────────────────────────────────────
 * product_eligibility (keyed by partnerProfileId) records whether a PARTNER may
 * SELL / earn from a product — it drives the agency partner-sell manager and the
 * commission writer.
 *
 * product_entitlements (keyed by customerUserId) records whether a CUSTOMER has
 * ACCESS to a product they purchased. These are separate concerns and live in
 * separate collections so customer access never pollutes the partner-sell system.
 *
 * ── Write access ──────────────────────────────────────────────────────────────
 * Server-only (Admin SDK). Written by the checkout.session.completed webhook via
 * grantProductEntitlement(). Clients can READ their own (customerUserId == uid);
 * agency owners can read all rows in their agency.
 */
export interface ProductEntitlement {
  id: string;                       // `${customerUserId}_${productId}`
  agencyId: string;
  subAccountId: string | null;
  customerUserId: string;
  productId: string;
  /** Denormalized product name at grant time — survives product renames. */
  productName: string;
  productFamily: ProductFamily | null;
  /** Denormalized from the product at grant time. */
  accessModel: AccessModel;
  status: EntitlementStatus;
  /** How this entitlement was granted. Extensible for future sources. */
  source: "marketplace_purchase";
  /** Stripe checkout session id that granted this entitlement. Null if granted another way. */
  grantingSessionId: string | null;
  grantedAt: Timestamp | FieldValue | null;
  revokedAt: Timestamp | FieldValue | null;
  /** uid of the agency owner who last revoked/reactivated. Null if never touched by admin. */
  reviewedByUid?: string | null;
  /** Agency-owner-only internal note. Not shown to the customer. */
  internalNote?: string | null;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}
