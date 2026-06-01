// src/lib/firestore/commission.ts
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  orderBy,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type {
  CommissionRule,
  CommissionEvent,
  CommissionStatus,
  PartnerReferral,
  PartnerReferralStatus,
} from "@/types/credits";

const COMMISSION_RULES = "commission_rules";
const COMMISSION_EVENTS = "commission_events";
const PARTNER_REFERRALS = "partner_referrals";

// ---------------------------------------------------------------------------
// commission_rules
// ---------------------------------------------------------------------------

export function subscribeToCommissionRules(
  agencyId: string,
  callback: (rules: CommissionRule[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), COMMISSION_RULES),
    where("agencyId", "==", agencyId),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CommissionRule, "id">) }))),
    (err) => onError?.(err),
  );
}

export async function createCommissionRule(
  data: Omit<CommissionRule, "id" | "createdAt" | "updatedAt">,
): Promise<string> {
  const ref = await addDoc(collection(getFirebaseDb(), COMMISSION_RULES), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

// ---------------------------------------------------------------------------
// commission_events
// ---------------------------------------------------------------------------

export function subscribeToPartnerCommissionEvents(
  partnerProfileId: string,
  callback: (events: CommissionEvent[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), COMMISSION_EVENTS),
    where("partnerProfileId", "==", partnerProfileId),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CommissionEvent, "id">) }))),
    (err) => onError?.(err),
  );
}

export function subscribeToCommissionEventsByStatus(
  agencyId: string,
  status: CommissionStatus,
  callback: (events: CommissionEvent[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), COMMISSION_EVENTS),
    where("agencyId", "==", agencyId),
    where("status", "==", status),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CommissionEvent, "id">) }))),
    (err) => onError?.(err),
  );
}

export async function createCommissionEvent(
  data: Omit<CommissionEvent, "id" | "createdAt" | "updatedAt">,
): Promise<string> {
  const ref = await addDoc(collection(getFirebaseDb(), COMMISSION_EVENTS), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateCommissionEventStatus(
  id: string,
  status: CommissionStatus,
  opts?: {
    paidOutNote?: string;
    voidReason?: string;
  },
): Promise<void> {
  await updateDoc(doc(getFirebaseDb(), COMMISSION_EVENTS, id), {
    status,
    ...(status === "paid" ? { paidOutAt: serverTimestamp() } : {}),
    ...(opts?.paidOutNote ? { paidOutNote: opts.paidOutNote } : {}),
    ...(status === "voided" ? { voidedAt: serverTimestamp() } : {}),
    ...(opts?.voidReason ? { voidReason: opts.voidReason } : {}),
    updatedAt: serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// partner_referrals
// ---------------------------------------------------------------------------

export async function createPartnerReferral(
  data: Omit<PartnerReferral, "id" | "createdAt" | "updatedAt">,
): Promise<string> {
  const ref = await addDoc(collection(getFirebaseDb(), PARTNER_REFERRALS), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export function subscribeToReferralsByPartner(
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
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PartnerReferral, "id">) }))),
    (err) => onError?.(err),
  );
}

export async function convertPartnerReferral(
  id: string,
  opts: {
    refereeUid: string;
    refereePartnerProfileId: string;
    commissionEventId: string;
  },
): Promise<void> {
  await updateDoc(doc(getFirebaseDb(), PARTNER_REFERRALS, id), {
    status: "converted" as PartnerReferralStatus,
    refereeUid: opts.refereeUid,
    refereePartnerProfileId: opts.refereePartnerProfileId,
    commissionEventId: opts.commissionEventId,
    convertedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
