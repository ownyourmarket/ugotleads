// src/lib/firestore/ledger.ts
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  setDoc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  orderBy,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type {
  LivingLedger,
  LedgerLine,
  AdminApproval,
  ApprovalStatus,
  StripeEvent,
  StripeEventStatus,
} from "@/types/ledger";

const LIVING_LEDGER = "living_ledger";
const ADMIN_APPROVALS = "admin_approvals";
const STRIPE_EVENTS = "stripe_events";

// ---------------------------------------------------------------------------
// living_ledger  (doc id = `${partnerProfileId}_${periodKey}`)
// ---------------------------------------------------------------------------

export function ledgerDocId(partnerProfileId: string, periodKey: string): string {
  return `${partnerProfileId}_${periodKey}`;
}

export async function getLedger(
  partnerProfileId: string,
  periodKey: string,
): Promise<LivingLedger | null> {
  const snap = await getDoc(
    doc(getFirebaseDb(), LIVING_LEDGER, ledgerDocId(partnerProfileId, periodKey)),
  );
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<LivingLedger, "id">) };
}

export async function appendLedgerLine(
  agencyId: string,
  partnerProfileId: string,
  periodKey: string,
  line: LedgerLine,
): Promise<void> {
  const id = ledgerDocId(partnerProfileId, periodKey);
  const ref = doc(getFirebaseDb(), LIVING_LEDGER, id);
  const snap = await getDoc(ref);
  const inflow  = line.amountCents > 0 ? line.amountCents : 0;
  const outflow = line.amountCents < 0 ? Math.abs(line.amountCents) : 0;

  if (!snap.exists()) {
    await setDoc(ref, {
      id, agencyId, partnerProfileId, periodKey,
      lines: [line],
      totalInCents: inflow,
      totalOutCents: outflow,
      netCents: line.amountCents,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  const existing = snap.data() as Omit<LivingLedger, "id">;
  await updateDoc(ref, {
    lines: [...existing.lines, line],
    totalInCents: existing.totalInCents + inflow,
    totalOutCents: existing.totalOutCents + outflow,
    netCents: existing.netCents + line.amountCents,
    updatedAt: serverTimestamp(),
  });
}

export function subscribeToLedger(
  partnerProfileId: string,
  periodKey: string,
  callback: (ledger: LivingLedger | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getFirebaseDb(), LIVING_LEDGER, ledgerDocId(partnerProfileId, periodKey)),
    (snap) => {
      if (!snap.exists()) { callback(null); return; }
      callback({ id: snap.id, ...(snap.data() as Omit<LivingLedger, "id">) });
    },
    (err) => onError?.(err),
  );
}

// ---------------------------------------------------------------------------
// admin_approvals
// ---------------------------------------------------------------------------

export async function createAdminApproval(
  data: Omit<AdminApproval, "id" | "createdAt" | "updatedAt">,
): Promise<string> {
  const ref = await addDoc(collection(getFirebaseDb(), ADMIN_APPROVALS), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export function subscribeToPendingApprovals(
  agencyId: string,
  callback: (approvals: AdminApproval[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), ADMIN_APPROVALS),
    where("agencyId", "==", agencyId),
    where("status", "==", "pending" as ApprovalStatus),
    orderBy("createdAt", "asc"),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AdminApproval, "id">) }))),
    (err) => onError?.(err),
  );
}

export async function updateApprovalStatus(
  id: string,
  status: ApprovalStatus,
  reviewedByUid: string,
  reviewNote?: string,
): Promise<void> {
  await updateDoc(doc(getFirebaseDb(), ADMIN_APPROVALS, id), {
    status,
    reviewedByUid,
    reviewedAt: serverTimestamp(),
    ...(reviewNote ? { reviewNote } : {}),
    updatedAt: serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// stripe_events  (doc id === Stripe event id — natural idempotency key)
// ---------------------------------------------------------------------------

export async function upsertStripeEvent(
  stripeEventId: string,
  data: Omit<StripeEvent, "id" | "createdAt" | "processedAt">,
): Promise<void> {
  await setDoc(
    doc(getFirebaseDb(), STRIPE_EVENTS, stripeEventId),
    {
      ...data,
      id: stripeEventId,
      processedAt: data.status === "processed" ? serverTimestamp() : null,
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function updateStripeEventStatus(
  id: string,
  status: StripeEventStatus,
  opts?: { handledBy?: string; outcome?: string; errorMessage?: string },
): Promise<void> {
  await updateDoc(doc(getFirebaseDb(), STRIPE_EVENTS, id), {
    status,
    ...(opts?.handledBy ? { handledBy: opts.handledBy } : {}),
    ...(opts?.outcome ? { outcome: opts.outcome } : {}),
    ...(opts?.errorMessage ? { errorMessage: opts.errorMessage } : {}),
    ...(status === "processed" ? { processedAt: serverTimestamp() } : {}),
  });
}
