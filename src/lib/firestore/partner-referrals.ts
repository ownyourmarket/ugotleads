// src/lib/firestore/partner-referrals.ts
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type { PartnerReferral } from "@/types/credits";

const PARTNER_REFERRALS = "partner_referrals";

// ---------------------------------------------------------------------------
// partner_referrals
// ---------------------------------------------------------------------------

/**
 * Real-time subscription to all referrals attributed to a given partner.
 * Ordered newest-first.
 *
 * NOTE: This is the MyUSA Partner system. Do NOT use the `referrals`
 * collection which belongs to the LeadStack founders affiliate program.
 */
export function subscribeToPartnerReferrals(
  referrerPartnerProfileId: string,
  callback: (referrals: PartnerReferral[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), PARTNER_REFERRALS),
    where("referrerPartnerProfileId", "==", referrerPartnerProfileId),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) =>
      callback(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<PartnerReferral, "id">),
        })),
      ),
    (err) => onError?.(err),
  );
}
