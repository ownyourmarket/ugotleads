import "server-only";

import type { Detector, ControlPlaneIssue } from "../types";

/**
 * Product readiness issues.
 *
 * - subscription_product_missing_price: active subscription product with no
 *   Stripe price ID. Critical when public (sellable-looking but broken),
 *   warning when not public.
 * - draft_product_public: draft product flagged public — marketplace
 *   exposure conflicts with draft state.
 */
export const productsDetector: Detector = {
  domain: "products",
  async run(ctx) {
    const snap = await ctx.db
      .collection("products")
      .where("agencyId", "==", ctx.agencyId)
      .select(
        "name",
        "status",
        "isPublic",
        "accessModel",
        "stripePriceIdMonthly",
        "stripePriceIdAnnual",
      )
      .limit(ctx.maxDocs)
      .get();

    const issues: ControlPlaneIssue[] = [];
    for (const doc of snap.docs) {
      const p = doc.data() as {
        name?: string;
        status?: string;
        isPublic?: boolean;
        accessModel?: string;
        stripePriceIdMonthly?: string | null;
        stripePriceIdAnnual?: string | null;
      };
      const name = p.name ?? doc.id;

      if (
        p.status === "active" &&
        p.accessModel === "subscription" &&
        !p.stripePriceIdMonthly &&
        !p.stripePriceIdAnnual
      ) {
        issues.push({
          domain: "products",
          issue_code: "subscription_product_missing_price",
          source_entity_type: "product",
          source_entity_id: doc.id,
          display_name: name,
          status: p.status,
          severity: p.isPublic ? "critical" : "warning",
          summary: `Active subscription product "${name}" has no Stripe price ID${p.isPublic ? " and is public in the marketplace" : ""}.`,
          safe_action_url: "/agency/products",
          metadata: { isPublic: p.isPublic === true },
        });
      }

      if (p.status === "draft" && p.isPublic === true) {
        issues.push({
          domain: "products",
          issue_code: "draft_product_public",
          source_entity_type: "product",
          source_entity_id: doc.id,
          display_name: name,
          status: p.status,
          severity: "warning",
          summary: `Draft product "${name}" is flagged public — hide it or activate it.`,
          safe_action_url: "/agency/products",
        });
      }
    }

    return { issues, truncated: snap.size >= ctx.maxDocs };
  },
};
