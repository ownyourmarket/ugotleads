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
