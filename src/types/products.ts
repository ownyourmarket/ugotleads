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
   * Operator-provided key for byok products.
   * Never returned to clients in API responses — show byokKeyLast4 only.
   */
  byokKey: string | null;
  byokKeyLast4: string | null;
  byokKeyValidatedAt: Timestamp | FieldValue | null;
  reviewedByUid: string | null;
  reviewedAt: Timestamp | FieldValue | null;
  reviewNote: string | null;
  expiresAt: Timestamp | FieldValue | null;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}
