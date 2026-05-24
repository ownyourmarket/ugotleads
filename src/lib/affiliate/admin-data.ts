import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import type { Affiliate, Referral } from "@/types/affiliate";

/**
 * Lists all affiliates sorted by lifetime commission (pending + paid) so
 * top performers float to the top of the admin table. Capped at 500 — at
 * that scale we'd add pagination, but it's a great problem to have first.
 */
export async function listAllAffiliates(): Promise<Affiliate[]> {
  const snap = await getAdminDb()
    .collection("affiliates")
    .orderBy("createdAt", "desc")
    .limit(500)
    .get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<Affiliate, "id">),
  }));
}

export async function getAffiliateById(
  id: string,
): Promise<Affiliate | null> {
  const snap = await getAdminDb().collection("affiliates").doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<Affiliate, "id">) };
}

/**
 * Lists all pending referrals across all affiliates, oldest first so the
 * payout queue acts as a FIFO. Capped at 500.
 */
export async function listPendingReferrals(): Promise<Referral[]> {
  const snap = await getAdminDb()
    .collection("referrals")
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .limit(500)
    .get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<Referral, "id">),
  }));
}

export async function listReferralsForAffiliateAdmin(
  affiliateId: string,
): Promise<Referral[]> {
  const snap = await getAdminDb()
    .collection("referrals")
    .where("affiliateId", "==", affiliateId)
    .orderBy("createdAt", "desc")
    .limit(500)
    .get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<Referral, "id">),
  }));
}

/**
 * Counts clicks per affiliate code. Returns a Map<code, count> for the
 * affiliates passed in — single batched aggregate query per code. For the
 * 500-row list view this is 500 small count() reads, which is fine on
 * Firestore's pricing model (aggregations are cheap).
 */
export async function countClicksForAffiliates(
  affiliates: Affiliate[],
): Promise<Map<string, number>> {
  const db = getAdminDb();
  const entries = await Promise.all(
    affiliates.map(async (a) => {
      const snap = await db
        .collection("clicks")
        .where("affiliateCode", "==", a.code)
        .count()
        .get();
      return [a.code, snap.data().count] as const;
    }),
  );
  return new Map(entries);
}

/**
 * Roll-up of program-wide totals for the admin header strip. One aggregate
 * scan of the affiliates collection — cheap because the doc carries the
 * running totals already.
 */
export interface ProgramTotals {
  affiliateCount: number;
  totalReferrals: number;
  totalPendingCents: number;
  totalPaidCents: number;
}

export function rollupTotals(affiliates: Affiliate[]): ProgramTotals {
  return affiliates.reduce<ProgramTotals>(
    (acc, a) => ({
      affiliateCount: acc.affiliateCount + 1,
      totalReferrals: acc.totalReferrals + a.referralCount,
      totalPendingCents: acc.totalPendingCents + a.pendingCommissionCents,
      totalPaidCents: acc.totalPaidCents + a.paidCommissionCents,
    }),
    {
      affiliateCount: 0,
      totalReferrals: 0,
      totalPendingCents: 0,
      totalPaidCents: 0,
    },
  );
}
