import "server-only";

import type { Firestore } from "firebase-admin/firestore";

export interface DomainCounts {
  products: { total: number; activePublic: number };
  purchases: { total: number; paid: number };
  entitlements: { total: number; active: number };
  partners: { total: number; active: number };
  commissions: { pending: number };
  creditWallets: { total: number };
  partnerEvents: { pending: number; failed: number };
}

export interface DomainCountsResult {
  counts: DomainCounts;
  /** True when any collection hit the query bound — counts may under-report. */
  truncated: boolean;
}

const MAX_DOCS = 2000;

/**
 * Bounded per-domain counts for the control-plane summary. Equality-only
 * queries with projections; no aggregates (kept fake-admin-compatible and
 * index-free). Sizes are exact below MAX_DOCS, floors at or above it.
 */
export async function loadDomainCounts(
  db: Firestore,
  agencyId: string,
): Promise<DomainCountsResult> {
  const bounded = (collection: string, ...extra: [string, unknown][]) => {
    let q = db.collection(collection).where("agencyId", "==", agencyId);
    for (const [field, value] of extra) q = q.where(field, "==", value);
    return q.select().limit(MAX_DOCS).get();
  };

  const [
    productsSnap,
    activePublicSnap,
    purchasesSnap,
    paidPurchasesSnap,
    entitlementsSnap,
    activeEntitlementsSnap,
    partnersSnap,
    activePartnersSnap,
    pendingCommissionsSnap,
    walletsSnap,
    pendingEventsSnap,
    failedEventsSnap,
  ] = await Promise.all([
    bounded("products"),
    db
      .collection("products")
      .where("agencyId", "==", agencyId)
      .where("status", "==", "active")
      .where("isPublic", "==", true)
      .select()
      .limit(MAX_DOCS)
      .get(),
    bounded("marketplace_purchases"),
    bounded("marketplace_purchases", ["paymentStatus", "paid"]),
    bounded("product_entitlements"),
    bounded("product_entitlements", ["status", "active"]),
    bounded("partner_profiles"),
    bounded("partner_profiles", ["status", "active"]),
    bounded("commission_events", ["status", "pending"]),
    bounded("credit_wallets"),
    bounded("partner_network_events", ["status", "pending"]),
    bounded("partner_network_events", ["status", "failed"]),
  ]);

  const snaps = [
    productsSnap,
    activePublicSnap,
    purchasesSnap,
    paidPurchasesSnap,
    entitlementsSnap,
    activeEntitlementsSnap,
    partnersSnap,
    activePartnersSnap,
    pendingCommissionsSnap,
    walletsSnap,
    pendingEventsSnap,
    failedEventsSnap,
  ];

  return {
    counts: {
      products: { total: productsSnap.size, activePublic: activePublicSnap.size },
      purchases: { total: purchasesSnap.size, paid: paidPurchasesSnap.size },
      entitlements: { total: entitlementsSnap.size, active: activeEntitlementsSnap.size },
      partners: { total: partnersSnap.size, active: activePartnersSnap.size },
      commissions: { pending: pendingCommissionsSnap.size },
      creditWallets: { total: walletsSnap.size },
      partnerEvents: { pending: pendingEventsSnap.size, failed: failedEventsSnap.size },
    },
    truncated: snaps.some((s) => s.size >= MAX_DOCS),
  };
}
