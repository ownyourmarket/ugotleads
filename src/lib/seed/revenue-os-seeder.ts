import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { Product, ProductFamily } from "@/types/products";
import type { PartnerTrack } from "@/types/partner";
import type { CommissionRule } from "@/types/credits";
import {
  SEED_PRODUCTS_ALL,
  SEED_TRACK_CERTIFIED_AI_CONSULTANT,
  SEED_TRACK_COMMUNITY_ADVOCATE,
  SEED_COMMISSION_RULE_PRODUCT_SALE,
  SEED_COMMISSION_RULE_SUBSCRIPTION_RENEWAL,
  SEED_COMMISSION_RULE_CERTIFICATION_SALE,
} from "./demo-data";

// ---------------------------------------------------------------------------
// Safety constants
// ---------------------------------------------------------------------------

const SEED_TAG = "revenue_os_v1";

/**
 * Deterministic slug IDs for every seeded doc.
 * Using fixed IDs means setDoc is idempotent — re-running overwrites the same
 * doc rather than creating duplicates.
 */
const PRODUCT_IDS: Record<string, string> = {
  "AI Lead Follow-Up Pack":                    "prod_ai_lead_followup",
  "AI Reputation Monitor":                     "prod_ai_reputation",
  "uGotLeads CRM Pro":                         "prod_crm_pro",
  "Certified AI Consultant Foundations":       "prod_cert_ai_consultant_course",
  "Done-For-You CRM Setup":                    "prod_dfy_crm_setup",
  "Local Business Outreach Playbook":          "prod_outreach_playbook",
  "MyUSA Local Business Directory Listing":   "prod_directory_listing",
};

const TRACK_IDS: Record<string, string> = {
  "Certified AI Consultant":           "track_certified_ai_consultant",
  "Support Local Community Advocate":  "track_community_advocate",
};

const COMMISSION_RULE_IDS: Record<string, string> = {
  "Standard Product Sale Commission":        "rule_product_sale_20pct",
  "CRM Pro Renewal Commission":              "rule_subscription_renewal_15pct",
  "Certification Product Sale Commission":   "rule_cert_sale_10pct",
};

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface SeedDryRunEntry {
  collection: string;
  docId: string;
  action: "create" | "overwrite";
  name: string;
}

export interface SeedRevenueOsResult {
  dryRun: boolean;
  agencyId: string;
  products: SeedDryRunEntry[];
  tracks: SeedDryRunEntry[];
  commissionRules: SeedDryRunEntry[];
  skipped: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Production guard
// ---------------------------------------------------------------------------

/**
 * Returns an error string if the call should be blocked, or null if it's safe.
 *
 * Blocks when ALL of the following are true simultaneously:
 *   - NODE_ENV is "production"
 *   - The explicit override env var REVENUE_OS_SEED_ALLOW_PRODUCTION is not "true"
 *
 * This means a developer who explicitly opts in on a production project can
 * still run the seed (e.g. to initialise a brand-new deployment), but accidental
 * production writes from a dev machine are blocked.
 */
function productionGuard(): string | null {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.REVENUE_OS_SEED_ALLOW_PRODUCTION !== "true"
  ) {
    return (
      "Production write blocked. " +
      "Set REVENUE_OS_SEED_ALLOW_PRODUCTION=true to explicitly enable " +
      "seeding against a production Firestore project."
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core seeder
// ---------------------------------------------------------------------------

/**
 * Seeds the Revenue OS product catalog, partner tracks, and commission rules
 * into Firestore using the Admin SDK.
 *
 * Idempotent — uses deterministic doc IDs so every re-run overwrites the same
 * docs rather than creating duplicates.
 *
 * @param db      - Admin Firestore instance (from getAdminDb())
 * @param agencyId - The agency that will own these docs
 * @param ownerUid - uid stamped on createdByUid
 * @param dryRun  - When true, no Firestore writes are made; returns preview only
 */
export async function seedRevenueOs(
  db: Firestore,
  agencyId: string,
  ownerUid: string,
  dryRun = true,
): Promise<SeedRevenueOsResult> {
  // Production guard — fail loudly before touching anything
  const guardErr = productionGuard();
  if (guardErr) {
    throw new Error(guardErr);
  }

  const result: SeedRevenueOsResult = {
    dryRun,
    agencyId,
    products: [],
    tracks: [],
    commissionRules: [],
    skipped: [],
    warnings: [],
  };

  const now = FieldValue.serverTimestamp();

  // ---- Products ----
  for (const template of SEED_PRODUCTS_ALL) {
    const docId = PRODUCT_IDS[template.name];
    if (!docId) {
      result.warnings.push(`No slug ID for product "${template.name}" — skipped.`);
      continue;
    }

    const existing = dryRun
      ? await db.collection("products").doc(docId).get()
      : null;

    const action: "create" | "overwrite" =
      dryRun && existing?.exists ? "overwrite" : "create";

    result.products.push({
      collection: "products",
      docId,
      action,
      name: template.name,
    });

    if (!dryRun) {
      const doc: Omit<Product, "id"> = {
        ...template,
        agencyId,
        createdByUid: ownerUid,
        createdAt: now,
        updatedAt: now,
      };
      await db.collection("products").doc(docId).set(
        { ...doc, _seedTag: SEED_TAG },
        { merge: false },
      );
    }
  }

  // ---- Partner tracks ----
  const trackTemplates = [
    SEED_TRACK_CERTIFIED_AI_CONSULTANT,
    SEED_TRACK_COMMUNITY_ADVOCATE,
  ];
  for (const template of trackTemplates) {
    const docId = TRACK_IDS[template.name];
    if (!docId) {
      result.warnings.push(`No slug ID for track "${template.name}" — skipped.`);
      continue;
    }

    const existing = dryRun
      ? await db.collection("partner_tracks").doc(docId).get()
      : null;

    result.tracks.push({
      collection: "partner_tracks",
      docId,
      action: dryRun && existing?.exists ? "overwrite" : "create",
      name: template.name,
    });

    if (!dryRun) {
      const doc: Omit<PartnerTrack, "id"> = {
        ...template,
        agencyId,
        createdByUid: ownerUid,
        createdAt: now,
        updatedAt: now,
      };
      await db.collection("partner_tracks").doc(docId).set(
        { ...doc, _seedTag: SEED_TAG },
        { merge: false },
      );
    }
  }

  // ---- Commission rules ----
  const ruleTemplates = [
    SEED_COMMISSION_RULE_PRODUCT_SALE,
    SEED_COMMISSION_RULE_SUBSCRIPTION_RENEWAL,
    SEED_COMMISSION_RULE_CERTIFICATION_SALE,
  ];
  for (const template of ruleTemplates) {
    const docId = COMMISSION_RULE_IDS[template.name];
    if (!docId) {
      result.warnings.push(`No slug ID for commission rule "${template.name}" — skipped.`);
      continue;
    }

    const existing = dryRun
      ? await db.collection("commission_rules").doc(docId).get()
      : null;

    result.commissionRules.push({
      collection: "commission_rules",
      docId,
      action: dryRun && existing?.exists ? "overwrite" : "create",
      name: template.name,
    });

    if (!dryRun) {
      const doc: Omit<CommissionRule, "id"> = {
        ...template,
        agencyId,
        createdByUid: ownerUid,
        createdAt: now,
        updatedAt: now,
      };
      await db.collection("commission_rules").doc(docId).set(
        { ...doc, _seedTag: SEED_TAG },
        { merge: false },
      );
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Rollback helper — deletes all docs written by this seeder
// ---------------------------------------------------------------------------

export interface RollbackRevenueOsResult {
  deletedProductIds: string[];
  deletedTrackIds: string[];
  deletedCommissionRuleIds: string[];
}

/**
 * Deletes every doc created by seedRevenueOs() using the deterministic IDs.
 * Safe to call even if some docs don't exist — missing docs are silently skipped.
 *
 * Also guarded against production writes unless REVENUE_OS_SEED_ALLOW_PRODUCTION=true.
 */
export async function rollbackRevenueOs(db: Firestore): Promise<RollbackRevenueOsResult> {
  const guardErr = productionGuard();
  if (guardErr) throw new Error(guardErr);

  const deletedProductIds: string[] = [];
  const deletedTrackIds: string[] = [];
  const deletedCommissionRuleIds: string[] = [];

  for (const id of Object.values(PRODUCT_IDS)) {
    await db.collection("products").doc(id).delete();
    deletedProductIds.push(id);
  }

  for (const id of Object.values(TRACK_IDS)) {
    await db.collection("partner_tracks").doc(id).delete();
    deletedTrackIds.push(id);
  }

  for (const id of Object.values(COMMISSION_RULE_IDS)) {
    await db.collection("commission_rules").doc(id).delete();
    deletedCommissionRuleIds.push(id);
  }

  return { deletedProductIds, deletedTrackIds, deletedCommissionRuleIds };
}

// ---------------------------------------------------------------------------
// Product catalog query helpers (Admin SDK — server only)
// ---------------------------------------------------------------------------

/**
 * Returns all products for an agency filtered by productFamily.
 * Useful for building server-side marketplace pages or seeding UI previews.
 */
export async function getProductsByFamily(
  db: Firestore,
  agencyId: string,
  family: ProductFamily,
): Promise<Product[]> {
  const snap = await db
    .collection("products")
    .where("agencyId", "==", agencyId)
    .where("productFamily", "==", family)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, "id">) }));
}

/**
 * Returns all products owned by a given owner identifier (e.g. "myusa_local").
 */
export async function getProductsByOwner(
  db: Firestore,
  agencyId: string,
  owner: string,
): Promise<Product[]> {
  const snap = await db
    .collection("products")
    .where("agencyId", "==", agencyId)
    .where("productOwner", "==", owner)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, "id">) }));
}

/**
 * Returns all products from a given source (e.g. "myusa_local", "partner_created").
 */
export async function getProductsBySource(
  db: Firestore,
  agencyId: string,
  source: string,
): Promise<Product[]> {
  const snap = await db
    .collection("products")
    .where("agencyId", "==", agencyId)
    .where("productSource", "==", source)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, "id">) }));
}
