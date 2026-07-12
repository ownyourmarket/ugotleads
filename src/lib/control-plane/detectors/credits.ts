import "server-only";

import type { Detector, ControlPlaneIssue } from "../types";

/**
 * Credit wallet health.
 *
 * - wallet_negative_balance: balances must never go below 0 by design —
 *   a negative value means an invariant broke.
 * - active_partner_missing_wallet: uses the credit_wallets doc-id ===
 *   partnerProfileId invariant, so wallet existence is a Set diff — no
 *   per-partner reads.
 */
export const creditsDetector: Detector = {
  domain: "credits",
  async run(ctx) {
    const [walletsSnap, partnersSnap] = await Promise.all([
      ctx.db
        .collection("credit_wallets")
        .where("agencyId", "==", ctx.agencyId)
        .select("partnerProfileId", "balanceCredits", "subAccountId")
        .limit(ctx.maxDocs)
        .get(),
      ctx.db
        .collection("partner_profiles")
        .where("agencyId", "==", ctx.agencyId)
        .select("displayName", "fullName", "status")
        .limit(ctx.maxDocs)
        .get(),
    ]);

    const issues: ControlPlaneIssue[] = [];
    const walletIds = new Set<string>();

    for (const doc of walletsSnap.docs) {
      walletIds.add(doc.id);
      const w = doc.data() as { balanceCredits?: number };
      if (typeof w.balanceCredits === "number" && w.balanceCredits < 0) {
        issues.push({
          domain: "credits",
          issue_code: "wallet_negative_balance",
          source_entity_type: "wallet",
          source_entity_id: doc.id,
          display_name: `Wallet ${doc.id}`,
          status: "negative",
          severity: "critical",
          summary: `Credit wallet has a negative balance (${w.balanceCredits}) — balances must never go below 0.`,
          safe_action_url: "/agency/credits",
          metadata: { balanceCredits: w.balanceCredits },
        });
      }
    }

    for (const doc of partnersSnap.docs) {
      const p = doc.data() as {
        displayName?: string | null;
        fullName?: string;
        status?: string;
      };
      if (p.status === "active" && !walletIds.has(doc.id)) {
        const name = p.displayName ?? p.fullName ?? doc.id;
        issues.push({
          domain: "credits",
          issue_code: "active_partner_missing_wallet",
          source_entity_type: "partner",
          source_entity_id: doc.id,
          display_name: name,
          status: "missing_wallet",
          severity: "warning",
          summary: `Active partner "${name}" has no credit wallet — initialize one before they can use credit features.`,
          safe_action_url: "/agency/credits",
        });
      }
    }

    return {
      issues,
      truncated: walletsSnap.size >= ctx.maxDocs || partnersSnap.size >= ctx.maxDocs,
    };
  },
};
