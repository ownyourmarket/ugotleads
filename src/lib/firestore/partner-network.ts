// src/lib/firestore/partner-network.ts
import {
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type { PartnerNetworkEvent } from "@/types/partner-network";

const PARTNER_NETWORK_EVENTS = "partner_network_events";

/**
 * Real-time subscription to all partner-network outbox events for an agency.
 * Agency-owner only (Firestore rules gate by isAgencyOwner).
 *
 * Single-field equality on agencyId — no composite index needed. The caller
 * sorts client-side (by createdAt desc).
 */
export function subscribeToPartnerNetworkEvents(
  agencyId: string,
  callback: (events: PartnerNetworkEvent[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), PARTNER_NETWORK_EVENTS),
    where("agencyId", "==", agencyId),
  );
  return onSnapshot(
    q,
    (snap) =>
      callback(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PartnerNetworkEvent, "id">) })),
      ),
    (err) => onError?.(err),
  );
}
