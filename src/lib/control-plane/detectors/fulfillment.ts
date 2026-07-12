import "server-only";

import type { Detector, ControlPlaneIssue } from "../types";

/**
 * Fulfillment issues — money collected without delivery.
 *
 * - paid_purchase_unfulfilled: paymentStatus "paid" but no fulfilledAt.
 *   The single highest-risk operational condition in the Revenue OS.
 */
export const fulfillmentDetector: Detector = {
  domain: "fulfillment",
  async run(ctx) {
    const snap = await ctx.db
      .collection("marketplace_purchases")
      .where("agencyId", "==", ctx.agencyId)
      .select("productName", "paymentStatus", "checkoutStatus", "entitlementId", "fulfilledAt")
      .limit(ctx.maxDocs)
      .get();

    const issues: ControlPlaneIssue[] = [];
    for (const doc of snap.docs) {
      const p = doc.data() as {
        productName?: string;
        paymentStatus?: string;
        checkoutStatus?: string;
        entitlementId?: string | null;
        fulfilledAt?: unknown;
      };

      if (p.paymentStatus === "paid" && !p.fulfilledAt) {
        issues.push({
          domain: "fulfillment",
          issue_code: "paid_purchase_unfulfilled",
          source_entity_type: "purchase",
          source_entity_id: doc.id,
          display_name: p.productName ?? doc.id,
          status: "paid_unfulfilled",
          severity: "critical",
          summary: `Paid purchase of "${p.productName ?? doc.id}" has no fulfillment — customer paid without receiving access. Use Repair Fulfillment.`,
          safe_action_url: "/agency/marketplace-purchases",
          metadata: { hasEntitlementId: Boolean(p.entitlementId) },
        });
      }
    }

    return { issues, truncated: snap.size >= ctx.maxDocs };
  },
};
