import "server-only";

import type { Detector, ControlPlaneIssue } from "../types";
import { toMillis } from "../types";

/**
 * Commission review issues. Read-only — never touches commission math.
 *
 * - commission_past_hold: pending event whose holdUntil has passed —
 *   ready for a human payout/void decision.
 * - commission_on_unpaid_purchase: a purchase carries a commissionEventId
 *   but its paymentStatus is not "paid" (refund/failed payment drift).
 */
export const commissionsDetector: Detector = {
  domain: "commissions",
  async run(ctx) {
    const [pendingSnap, purchasesSnap] = await Promise.all([
      ctx.db
        .collection("commission_events")
        .where("agencyId", "==", ctx.agencyId)
        .where("status", "==", "pending")
        .select("partnerProfileId", "commissionCents", "holdUntil")
        .limit(ctx.maxDocs)
        .get(),
      ctx.db
        .collection("marketplace_purchases")
        .where("agencyId", "==", ctx.agencyId)
        .select("productName", "paymentStatus", "commissionEventId")
        .limit(ctx.maxDocs)
        .get(),
    ]);

    const issues: ControlPlaneIssue[] = [];

    for (const doc of pendingSnap.docs) {
      const e = doc.data() as {
        partnerProfileId?: string;
        commissionCents?: number;
        holdUntil?: unknown;
      };
      const holdMs = toMillis(e.holdUntil);
      if (holdMs !== null && holdMs < ctx.now) {
        issues.push({
          domain: "commissions",
          issue_code: "commission_past_hold",
          source_entity_type: "commission",
          source_entity_id: doc.id,
          display_name: `Commission ${doc.id}`,
          status: "pending",
          severity: "warning",
          summary: "Pending commission is past its hold date — review for payout or void.",
          safe_action_url: "/agency/commissions",
          metadata: {
            commissionCents: e.commissionCents ?? 0,
            partnerProfileId: e.partnerProfileId ?? null,
          },
        });
      }
    }

    for (const doc of purchasesSnap.docs) {
      const p = doc.data() as {
        productName?: string;
        paymentStatus?: string;
        commissionEventId?: string | null;
      };
      if (p.commissionEventId && p.paymentStatus !== "paid") {
        issues.push({
          domain: "commissions",
          issue_code: "commission_on_unpaid_purchase",
          source_entity_type: "purchase",
          source_entity_id: doc.id,
          display_name: p.productName ?? doc.id,
          status: p.paymentStatus ?? "unknown",
          severity: "critical",
          summary: `Purchase of "${p.productName ?? doc.id}" has a commission event but payment status is "${p.paymentStatus ?? "unknown"}" — review the commission.`,
          safe_action_url: "/agency/commissions",
          metadata: { commissionEventId: p.commissionEventId },
        });
      }
    }

    return {
      issues,
      truncated: pendingSnap.size >= ctx.maxDocs || purchasesSnap.size >= ctx.maxDocs,
    };
  },
};
