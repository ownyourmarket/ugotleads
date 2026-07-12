import "server-only";

import type { Detector, ControlPlaneIssue } from "../types";

/**
 * Partner health issues. display_name uses displayName ?? fullName — never
 * email or phone (PII rule).
 *
 * - partner_missing_referral_code: active/approved partner cannot be
 *   attributed on referrals.
 * - suspended_partner_pending_commissions: suspended/terminated partner
 *   still carries pending commission cents — needs a review decision.
 */
export const partnersDetector: Detector = {
  domain: "partners",
  async run(ctx) {
    const snap = await ctx.db
      .collection("partner_profiles")
      .where("agencyId", "==", ctx.agencyId)
      .select("displayName", "fullName", "status", "referralCode", "pendingCommissionCents")
      .limit(ctx.maxDocs)
      .get();

    const issues: ControlPlaneIssue[] = [];
    for (const doc of snap.docs) {
      const p = doc.data() as {
        displayName?: string | null;
        fullName?: string;
        status?: string;
        referralCode?: string | null;
        pendingCommissionCents?: number;
      };
      const name = p.displayName ?? p.fullName ?? doc.id;

      if ((p.status === "active" || p.status === "approved") && !p.referralCode) {
        issues.push({
          domain: "partners",
          issue_code: "partner_missing_referral_code",
          source_entity_type: "partner",
          source_entity_id: doc.id,
          display_name: name,
          status: p.status,
          severity: "warning",
          summary: `Partner "${name}" is ${p.status} but has no referral code — their referrals cannot be attributed.`,
          safe_action_url: "/agency/partners",
        });
      }

      if (
        (p.status === "suspended" || p.status === "terminated") &&
        (p.pendingCommissionCents ?? 0) > 0
      ) {
        issues.push({
          domain: "partners",
          issue_code: "suspended_partner_pending_commissions",
          source_entity_type: "partner",
          source_entity_id: doc.id,
          display_name: name,
          status: p.status ?? "unknown",
          severity: "warning",
          summary: `Partner "${name}" is ${p.status} but has pending commissions — review before payout.`,
          safe_action_url: "/agency/partners",
          metadata: { pendingCommissionCents: p.pendingCommissionCents ?? 0 },
        });
      }
    }

    return { issues, truncated: snap.size >= ctx.maxDocs };
  },
};
