// src/lib/firestore/entitlements.ts
import {
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type { ProductEntitlement } from "@/types/products";

const PRODUCT_ENTITLEMENTS = "product_entitlements";

/**
 * Real-time subscription to a customer's own product entitlements.
 *
 * Queries by customerUserId only (single-field equality — no composite index
 * required). The caller filters by sub-account and sorts client-side.
 *
 * Firestore rules allow a customer to read rows where
 * customerUserId == request.auth.uid, so this is safe for the logged-in user.
 */
export function subscribeToCustomerEntitlements(
  customerUserId: string,
  callback: (entitlements: ProductEntitlement[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), PRODUCT_ENTITLEMENTS),
    where("customerUserId", "==", customerUserId),
  );
  return onSnapshot(
    q,
    (snap) =>
      callback(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProductEntitlement, "id">) })),
      ),
    (err) => onError?.(err),
  );
}

/**
 * Real-time subscription to ALL product entitlements for an agency.
 * Agency-owner only (Firestore rules gate by isAgencyOwner). Optional helper
 * for a future admin view; not used by the customer access page.
 */
export function subscribeToAgencyEntitlements(
  agencyId: string,
  callback: (entitlements: ProductEntitlement[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), PRODUCT_ENTITLEMENTS),
    where("agencyId", "==", agencyId),
  );
  return onSnapshot(
    q,
    (snap) =>
      callback(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProductEntitlement, "id">) })),
      ),
    (err) => onError?.(err),
  );
}
