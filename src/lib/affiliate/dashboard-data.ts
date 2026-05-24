import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import type { Referral } from "@/types/affiliate";

/**
 * Loads an affiliate's referrals, most-recent first. Capped at 200 — more
 * than that and we'd build pagination, but at $891 per sale that's ~$178k
 * in commissions which is a great problem to have first.
 */
export async function listReferralsForAffiliate(
  affiliateId: string,
): Promise<Referral[]> {
  const snap = await getAdminDb()
    .collection("referrals")
    .where("affiliateId", "==", affiliateId)
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<Referral, "id">),
  }));
}

/**
 * Lightweight stats roll-up for the dashboard header. The Affiliate doc
 * already carries the running totals (referralCount, pendingCommissionCents,
 * paidCommissionCents) so we don't need an aggregate query here — those
 * are kept in sync by the referral creation + payout flows.
 */
export interface AffiliateStats {
  referralCount: number;
  pendingCommissionCents: number;
  paidCommissionCents: number;
  totalCommissionCents: number;
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}
