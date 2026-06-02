/**
 * src/lib/credits/server.ts
 *
 * Server-side (Admin SDK) credit wallet mutations.
 *
 * The client-side `applyCreditDelta` in lib/firestore/credits.ts is blocked
 * by Firestore rules (`allow update: if false` on credit_wallets, `allow
 * create: if false` on credit_transactions). All balance mutations MUST go
 * through this helper, which uses the Admin SDK to bypass rules.
 *
 * ── Idempotency note ───────────────────────────────────────────────────────
 * Callers that need idempotency (e.g. Stripe webhook retries) should pass
 * a stable `referenceId` and check for existing credit_transactions with
 * that referenceId before calling. This helper does not self-deduplicate.
 *
 * ── No MLM / compensation plan logic ─────────────────────────────────────
 * This file handles credit deltas only. No genealogy, downline, rank bonus,
 * team volume, binary, unilevel, or compensation plan math.
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
