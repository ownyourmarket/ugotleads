/**
 * src/lib/credits/server.ts
 *
 * Server-side (Admin SDK) credit wallet mutations.
 *
 * The client-side `applyCreditDelta` in lib/firestore/credits.ts is blocked
 * by Firestore rules (`allow update: if false` on credit_wallets, `allow
 * create: if false` on credit_transactions). All balance mutations MUST go
 * through this file, which uses the Admin SDK to bypass rules.
 *
 * ── Entry points ───────────────────────────────────────────────────────────
 * serverApplyCreditDelta  — general-purpose delta (purchase, refund, adjustment)
 * spendCredits            — debit path with balance check + idempotency key
 *
 * ── No MLM / compensation plan logic ─────────────────────────────────────
 * Credit deltas only. No genealogy, downline, rank bonus, team volume,
 * binary, unilevel, or compensation plan math.
 */

import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import type { CreditWallet, CreditTransaction, CreditTxnType } from "@/types/credits";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServerCreditDeltaInput {
  agencyId: string;
  partnerProfileId: string;
  /** Positive = add credits; negative = deduct credits. Balance is clamped at 0. */
  delta: number;
  type: CreditTxnType;
  description: string;
  referenceId?: string | null;
  referenceType?: CreditTransaction["referenceType"];
  createdByUid?: string | null;
}

export type ServerCreditDeltaResult =
  | { ok: true; newBalance: number; transactionId: string; actualDelta: number }
  | { error: true; message: string };

// ---------------------------------------------------------------------------
// Main helper
// ---------------------------------------------------------------------------

/**
 * Atomically apply a credit delta using the Admin SDK.
 * Auto-creates the wallet if it doesn't exist.
 * Balance is clamped at 0 (debits never produce a negative balance).
 *
 * Returns the new balance and the written credit_transactions doc id.
 */
export async function serverApplyCreditDelta(
  input: ServerCreditDeltaInput,
): Promise<ServerCreditDeltaResult> {
  if (input.delta === 0) {
    return { error: true, message: "Delta cannot be zero." };
  }

  const db = getAdminDb();
  const walletRef = db.collection("credit_wallets").doc(input.partnerProfileId);
  const txnRef = db.collection("credit_transactions").doc();
  const transactionId = txnRef.id;

  let newBalance = 0;
  let actualDelta = 0;

  try {
    await db.runTransaction(async (tx) => {
      const walletSnap = await tx.get(walletRef);

      if (!walletSnap.exists) {
        // Wallet doesn't exist yet — create it with the initial delta
        newBalance = Math.max(0, input.delta);
        actualDelta = newBalance; // can't go negative on create

        tx.set(walletRef, {
          id: input.partnerProfileId,
          agencyId: input.agencyId,
          partnerProfileId: input.partnerProfileId,
          balanceCredits: newBalance,
          lifetimePurchasedCredits: input.type === "purchase" ? Math.abs(actualDelta) : 0,
          lifetimeSpentCredits: input.type === "spend" ? Math.abs(actualDelta) : 0,
          lifetimeRefundedCredits: input.type === "refund" ? Math.abs(actualDelta) : 0,
          stripeCustomerId: null,
          subAccountId: null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        } satisfies Omit<CreditWallet, "createdAt" | "updatedAt"> & {
          createdAt: ReturnType<typeof FieldValue.serverTimestamp>;
          updatedAt: ReturnType<typeof FieldValue.serverTimestamp>;
        });
      } else {
        const wallet = walletSnap.data() as Omit<CreditWallet, "id">;
        const currentBalance = wallet.balanceCredits;
        newBalance = Math.max(0, currentBalance + input.delta);
        actualDelta = newBalance - currentBalance;

        const updates: Record<string, unknown> = {
          balanceCredits: newBalance,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (input.type === "purchase") {
          updates.lifetimePurchasedCredits = FieldValue.increment(Math.abs(actualDelta));
        } else if (input.type === "spend") {
          updates.lifetimeSpentCredits = FieldValue.increment(Math.abs(actualDelta));
        } else if (input.type === "refund") {
          updates.lifetimeRefundedCredits = FieldValue.increment(Math.abs(actualDelta));
        }

        tx.update(walletRef, updates);
      }

      // Write the transaction record
      tx.set(txnRef, {
        walletId: input.partnerProfileId,
        agencyId: input.agencyId,
        partnerProfileId: input.partnerProfileId,
        delta: actualDelta,
        type: input.type,
        balanceAfter: newBalance,
        description: input.description,
        referenceId: input.referenceId ?? null,
        referenceType: input.referenceType ?? null,
        createdByUid: input.createdByUid ?? null,
        createdAt: FieldValue.serverTimestamp(),
      } as Omit<CreditTransaction, "id">);
    });

    console.info(
      `[credits] Applied delta ${actualDelta} (requested ${input.delta}) to ${input.partnerProfileId} — new balance: ${newBalance} — txn: ${transactionId}`,
    );

    return { ok: true, newBalance, transactionId, actualDelta };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Firestore transaction failed.";
    console.error(`[credits] serverApplyCreditDelta failed for ${input.partnerProfileId}:`, err);
    return { error: true, message };
  }
}

// ---------------------------------------------------------------------------
// spendCredits — debit path with balance guard + idempotency
// ---------------------------------------------------------------------------

export interface SpendCreditsInput {
  /** Top-level tenant. */
  agencyId: string;
  /** Partner wallet to debit. doc id === partnerProfileId. */
  partnerProfileId: string;
  /** Sub-account associated with this usage event (for audit). */
  subAccountId: string | null;
  /** Number of credits to deduct. Must be positive. */
  amount: number;
  /** Human-readable reason shown in the partner's transaction history. */
  reason: string;
  /**
   * Stable unique key for this spend operation. Used as the credit_transactions
   * doc id — a second call with the same operationId returns { skipped } without
   * touching the wallet. Callers MUST use a deterministic key derived from the
   * originating event (e.g. `ai_run_${aiRunId}` or `product_use_${sessionId}`).
   */
  operationId: string;
  /**
   * Arbitrary string key-value pairs for audit. Logged server-side but NOT
   * stored on the CreditTransaction doc (no schema change needed).
   */
  metadata?: Record<string, string | number | boolean | null>;
}

export type SpendCreditsResult =
  | { ok: true; newBalance: number; transactionId: string }
  | { skipped: true; reason: "duplicate_operation" }
  | { insufficient_balance: true; currentBalance: number; required: number }
  | { wallet_not_found: true }
  | { error: true; message: string };

/**
 * Debit a partner's credit wallet atomically.
 *
 * Guards (checked in order):
 *   1. amount > 0
 *   2. duplicate operationId → { skipped }
 *   3. wallet not found → { wallet_not_found }
 *   4. balance < amount → { insufficient_balance }
 *
 * On success:
 *   - wallet.balanceCredits decremented by amount (clamped to 0 not needed —
 *     the balance check guarantees enough funds before any write)
 *   - wallet.lifetimeSpentCredits incremented by amount
 *   - credit_transactions/{operationId} doc created (idempotency key)
 *
 * Returns { ok: true, newBalance, transactionId } on success.
 */
export async function spendCredits(
  input: SpendCreditsInput,
): Promise<SpendCreditsResult> {
  if (input.amount <= 0) {
    return { error: true, message: "amount must be a positive number." };
  }
  if (!input.operationId.trim()) {
    return { error: true, message: "operationId is required." };
  }

  const db = getAdminDb();
  const walletRef = db.collection("credit_wallets").doc(input.partnerProfileId);
  const txnRef = db.collection("credit_transactions").doc(input.operationId);

  // ── Idempotency pre-check ─────────────────────────────────────────────────
  // Avoids entering the Firestore transaction on a definite duplicate.
  // A race between this check and the tx.create is handled by catching
  // ALREADY_EXISTS (code 6) from the transaction itself.
  const existingSnap = await txnRef.get().catch(() => null);
  if (existingSnap?.exists) {
    console.info(`[credits/spend] Duplicate operationId ${input.operationId} — skipped.`);
    return { skipped: true, reason: "duplicate_operation" };
  }

  // ── Flags set inside the transaction callback ──────────────────────────────
  let walletMissing = false;
  let balanceShortfall = false;
  let currentBalance = 0;
  let newBalance = 0;

  try {
    await db.runTransaction(async (tx) => {
      const walletSnap = await tx.get(walletRef);

      if (!walletSnap.exists) {
        walletMissing = true;
        // Returning without any writes causes a no-op commit — see flag check below.
        return;
      }

      const wallet = walletSnap.data() as Omit<CreditWallet, "id">;
      currentBalance = wallet.balanceCredits;

      if (currentBalance < input.amount) {
        balanceShortfall = true;
        return; // no-op commit — see flag check below
      }

      newBalance = currentBalance - input.amount;

      tx.update(walletRef, {
        balanceCredits: newBalance,
        lifetimeSpentCredits: FieldValue.increment(input.amount),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // tx.create throws ALREADY_EXISTS (code 6) if race with another request.
      tx.create(txnRef, {
        walletId: input.partnerProfileId,
        agencyId: input.agencyId,
        partnerProfileId: input.partnerProfileId,
        delta: -input.amount,
        type: "spend" as CreditTransaction["type"],
        balanceAfter: newBalance,
        description: input.reason,
        referenceId: input.operationId,
        referenceType: null,
        createdByUid: null,
        // Persist metadata for audit — only when provided and non-empty
        ...(input.metadata && Object.keys(input.metadata).length > 0
          ? { metadata: input.metadata }
          : {}),
        createdAt: FieldValue.serverTimestamp(),
      } as Omit<CreditTransaction, "id">);
    });

    // ── Check flags set during the transaction ────────────────────────────
    if (walletMissing) {
      console.warn(`[credits/spend] Wallet not found for ${input.partnerProfileId}`);
      return { wallet_not_found: true };
    }
    if (balanceShortfall) {
      console.warn(
        `[credits/spend] Insufficient balance for ${input.partnerProfileId}: ` +
        `has ${currentBalance}, needs ${input.amount}`,
      );
      return { insufficient_balance: true, currentBalance, required: input.amount };
    }

    if (input.metadata && Object.keys(input.metadata).length > 0) {
      console.info(`[credits/spend] ${input.operationId}`, input.metadata);
    }
    console.info(
      `[credits/spend] Deducted ${input.amount} from ${input.partnerProfileId} ` +
      `(${input.subAccountId ?? "no-sa"}) — new balance: ${newBalance} — op: ${input.operationId}`,
    );

    return { ok: true, newBalance, transactionId: input.operationId };
  } catch (err) {
    // Race: another process created the txn doc between our pre-check and tx.create
    const firestoreCode = (err as { code?: number })?.code;
    if (firestoreCode === 6) {
      console.info(`[credits/spend] Race-condition duplicate for ${input.operationId} — skipped.`);
      return { skipped: true, reason: "duplicate_operation" };
    }
    const message = err instanceof Error ? err.message : "Firestore transaction failed.";
    console.error(`[credits/spend] Failed for ${input.partnerProfileId} op ${input.operationId}:`, err);
    return { error: true, message };
  }
}
