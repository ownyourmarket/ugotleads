// src/lib/firestore/credits.ts
import {
  collection,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  orderBy,
  runTransaction,
  increment,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type { CreditWallet, CreditTransaction, CreditTxnType } from "@/types/credits";

const CREDIT_WALLETS = "credit_wallets";
const CREDIT_TRANSACTIONS = "credit_transactions";

// ---------------------------------------------------------------------------
// credit_wallets  (doc id === partnerProfileId)
// ---------------------------------------------------------------------------

export async function getCreditWallet(partnerProfileId: string): Promise<CreditWallet | null> {
  const snap = await getDoc(doc(getFirebaseDb(), CREDIT_WALLETS, partnerProfileId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<CreditWallet, "id">) };
}

export function subscribeToCreditWallet(
  partnerProfileId: string,
  callback: (wallet: CreditWallet | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getFirebaseDb(), CREDIT_WALLETS, partnerProfileId),
    (snap) => {
      if (!snap.exists()) { callback(null); return; }
      callback({ id: snap.id, ...(snap.data() as Omit<CreditWallet, "id">) });
    },
    (err) => onError?.(err),
  );
}

export async function createCreditWallet(
  data: Omit<
    CreditWallet,
    | "id" | "balanceCredits" | "lifetimePurchasedCredits"
    | "lifetimeSpentCredits" | "lifetimeRefundedCredits"
    | "createdAt" | "updatedAt"
  >,
): Promise<void> {
  await setDoc(doc(getFirebaseDb(), CREDIT_WALLETS, data.partnerProfileId), {
    ...data,
    id: data.partnerProfileId,
    balanceCredits: 0,
    lifetimePurchasedCredits: 0,
    lifetimeSpentCredits: 0,
    lifetimeRefundedCredits: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Atomically apply a credit delta and record the transaction.
 * Use for ALL balance mutations — never update the wallet doc directly.
 * Balance is clamped at 0 (can't go negative).
 * Returns the new credit_transactions doc id.
 */
export async function applyCreditDelta(
  partnerProfileId: string,
  delta: number,
  type: CreditTxnType,
  description: string,
  opts?: {
    referenceId?: string;
    referenceType?: CreditTransaction["referenceType"];
    createdByUid?: string;
  },
): Promise<string> {
  const db = getFirebaseDb();
  const walletRef = doc(db, CREDIT_WALLETS, partnerProfileId);
  const txnRef = doc(collection(db, CREDIT_TRANSACTIONS));
  const newTxnId = txnRef.id;

  await runTransaction(db, async (tx) => {
    const walletSnap = await tx.get(walletRef);
    if (!walletSnap.exists()) {
      throw new Error(`CreditWallet not found for partner: ${partnerProfileId}`);
    }
    const wallet = walletSnap.data() as Omit<CreditWallet, "id">;
    const newBalance = Math.max(0, wallet.balanceCredits + delta);
    const actualDelta = newBalance - wallet.balanceCredits;

    const lifetimeUpdate: Record<string, unknown> = {};
    if (type === "purchase") lifetimeUpdate.lifetimePurchasedCredits = increment(Math.abs(actualDelta));
    if (type === "spend")    lifetimeUpdate.lifetimeSpentCredits    = increment(Math.abs(actualDelta));
    if (type === "refund")   lifetimeUpdate.lifetimeRefundedCredits  = increment(Math.abs(actualDelta));

    tx.update(walletRef, { balanceCredits: newBalance, ...lifetimeUpdate, updatedAt: serverTimestamp() });
    tx.set(txnRef, {
      walletId: partnerProfileId,
      agencyId: wallet.agencyId,
      partnerProfileId,
      delta: actualDelta,
      type,
      balanceAfter: newBalance,
      description,
      referenceId: opts?.referenceId ?? null,
      referenceType: opts?.referenceType ?? null,
      createdByUid: opts?.createdByUid ?? null,
      createdAt: serverTimestamp(),
    } as Omit<CreditTransaction, "id">);
  });

  return newTxnId;
}

export function subscribeToCreditTransactions(
  partnerProfileId: string,
  callback: (txns: CreditTransaction[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), CREDIT_TRANSACTIONS),
    where("partnerProfileId", "==", partnerProfileId),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CreditTransaction, "id">) }))),
    (err) => onError?.(err),
  );
}

/**
 * Real-time subscription to ALL credit wallets for an agency.
 * Used by the agency admin credits page.
 * No composite index required — single-field equality on agencyId.
 */
export function subscribeToAgencyWallets(
  agencyId: string,
  callback: (wallets: CreditWallet[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), CREDIT_WALLETS),
    where("agencyId", "==", agencyId),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CreditWallet, "id">) }))),
    (err) => onError?.(err),
  );
}
