import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";

/**
 * Resolves a partner referral code to a partnerProfileId (uid).
 *
 * Queries partner_profiles where referralCode === code.
 * Only returns a result when the partner's status is "active" or "approved"
 * so suspended/terminated partners can no longer receive new referrals.
 *
 * Returns null when:
 *   - code is blank or invalid
 *   - no partner profile matches the code
 *   - the matching partner is suspended, terminated, or applied
 *   - Firestore lookup fails (fail-open: signup must never be blocked)
 *
 * NOTE: This performs a collection-scan query on a single equality filter
 * (referralCode). It requires a single-field index on partner_profiles.referralCode
 * which Firestore auto-creates for equality queries — no composite index needed.
 */
export async function resolvePartnerReferralCode(
  code: string,
): Promise<string | null> {
  if (!code || code.length > 64) return null;

  try {
    const db = getAdminDb();
    const snap = await db
      .collection("partner_profiles")
      .where("referralCode", "==", code.trim().toUpperCase())
      .limit(1)
      .get();

    if (snap.empty) return null;

    const doc = snap.docs[0];
    const data = doc.data();
    const status = data?.status as string | undefined;

    // Only active or approved partners generate valid referrals.
    if (status !== "active" && status !== "approved") {
      console.warn(
        `[partner-referral] code "${code}" matched partner ${doc.id} but status is "${status}" — skipping`,
      );
      return null;
    }

    return doc.id; // doc id === uid === partnerProfileId
  } catch (err) {
    // Fail-open: a Firestore error must never block signup.
    console.error("[partner-referral] resolvePartnerReferralCode error:", err);
    return null;
  }
}
