import "server-only";

import type { Detector, ControlPlaneIssue } from "../types";

/**
 * BYOK configuration status.
 *
 * SECURITY: reads ONLY the client-safe mirrors on product_eligibility
 * (byokConfigured / byokKeyLast4). Never queries the server-only
 * byok_keys collection, never returns key material of any kind.
 *
 * - byok_not_configured: approved BYOK-model eligibility where the
 *   partner has not stored a key yet — the product cannot run.
 */
export const byokDetector: Detector = {
  domain: "byok",
  async run(ctx) {
    const snap = await ctx.db
      .collection("product_eligibility")
      .where("agencyId", "==", ctx.agencyId)
      .where("status", "==", "approved")
      .select("partnerProfileId", "productId", "accessModel", "byokConfigured")
      .limit(ctx.maxDocs)
      .get();

    const issues: ControlPlaneIssue[] = [];
    for (const doc of snap.docs) {
      const e = doc.data() as {
        partnerProfileId?: string;
        productId?: string;
        accessModel?: string;
        byokConfigured?: boolean;
      };
      if (e.accessModel === "byok" && e.byokConfigured !== true) {
        issues.push({
          domain: "byok",
          issue_code: "byok_not_configured",
          source_entity_type: "eligibility",
          source_entity_id: doc.id,
          display_name: `Eligibility ${doc.id}`,
          status: "approved_no_key",
          severity: "warning",
          summary: "Approved BYOK eligibility has no API key configured — the partner cannot operate this product yet.",
          safe_action_url: "/agency/product-eligibility",
          metadata: {
            productId: e.productId ?? null,
            partnerProfileId: e.partnerProfileId ?? null,
          },
        });
      }
    }

    return { issues, truncated: snap.size >= ctx.maxDocs };
  },
};
