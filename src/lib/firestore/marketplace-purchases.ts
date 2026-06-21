// src/lib/firestore/marketplace-purchases.ts
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type { MarketplacePurchase } from "@/types/marketplace";

const MARKETPLACE_PURCHASES = "marketplace_purchases";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPurchase(id: string, data: Record<string, unknown>): MarketplacePurchase {
  return { id, ...(data as Omit<MarketplacePurchase, "id">) };
}

// ---------------------------------------------------------------------------
// Subscriptions — client-side (real-time)
// ---------------------------------------------------------------------------

/**
 * Real-time subscription to purchases for a specific sub-account.
 * Used on the customer purchase history page.
 * Ordered newest-first.
 *
 * Requires composite index:
 *   marketplace_purchases: subAccountId ASC, createdAt DESC
 */
export function subscribeToSubAccountPurchases(
  subAccountId: string,
  callback: (purchases: MarketplacePurchase[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), MARKETPLACE_PURCHASES),
    where("subAccountId", "==", subAccountId),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => toPurchase(d.id, d.data()))),
    (err) => onError?.(err),
  );
}

/**
 * Real-time subscription to purchases attributed to a specific partner.
 * Used on the partner profile "Attributed Sales" section.
 * Ordered newest-first.
 *
 * Requires composite index:
 *   marketplace_purchases: referredByPartnerProfileId ASC, createdAt DESC
 */
export function subscribeToAttributedPurchases(
  partnerProfileId: string,
  callback: (purchases: MarketplacePurchase[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), MARKETPLACE_PURCHASES),
    where("referredByPartnerProfileId", "==", partnerProfileId),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => toPurchase(d.id, d.data()))),
    (err) => onError?.(err),
  );
}

/**
 * Real-time subscription to ALL purchases for an agency.
 * Used by the agency admin marketplace-purchases page.
 * Ordered newest-first.
 *
 * Requires composite index:
 *   marketplace_purchases: agencyId ASC, createdAt DESC
 */
export function subscribeToAgencyPurchases(
  agencyId: string,
  callback: (purchases: MarketplacePurchase[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), MARKETPLACE_PURCHASES),
    where("agencyId", "==", agencyId),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => toPurchase(d.id, d.data()))),
    (err) => onError?.(err),
  );
}
