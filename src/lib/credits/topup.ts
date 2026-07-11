/**
 * src/lib/credits/topup.ts
 *
 * Pure/DI'd fulfillment engine for Stripe credit top-ups. Mirrors the shape of
 * lib/promptexpert/run-skill.ts — no firebase imports here; the webhook
 * (already server-only) supplies real Admin SDK-backed deps.
 *
 * ── Why validate AND re-derive from CREDIT_PACKS ────────────────────────────
 * `credits` arrives from Stripe session.metadata, which is attacker-influenceable
 * in principle (metadata can be forged on a replayed/crafted event, or drift if
 * CREDIT_PACKS changes between session creation and webhook delivery). We both
 * bound it (int, 0 < credits <= 100_000) and cross-check it against the pack's
 * real credit amount by packId — any mismatch is rejected outright rather than
 * trusting whichever number happens to be smaller/larger.
 */

import { CREDIT_PACKS } from "@/types/promptexpert";

export interface FulfillTopupDeps {
  /** credit_transactions where referenceId == sessionId, limit 1. */
  findTxnByReference(referenceId: string): Promise<boolean>;
  /**
   * Create-if-missing with subAccountId STAMPED. If the wallet exists with
   * subAccountId null, set it (merge). Never overwrite a DIFFERENT existing
   * subAccountId — leave it and log. This pre-step exists specifically to
   * neutralize the auto-create-with-null-subAccountId behavior in
   * serverApplyCreditDelta (see src/lib/credits/server.ts) — by the time
   * applyCredit runs, the wallet is guaranteed to already exist with the
   * correct subAccountId, so applyCredit's own auto-create path never fires
   * for a top-up.
   */
  ensureWallet(input: {
    walletId: string;
    agencyId: string;
    subAccountId: string;
  }): Promise<void>;
  applyCredit(input: {
    agencyId: string;
    partnerProfileId: string;
    delta: number;
    description: string;
    referenceId: string;
  }): Promise<{ ok: true } | { skipped: true } | { error: true; message: string }>;
}

export interface TopupEvent {
  sessionId: string;
  agencyId: string;
  subAccountId: string;
  purchaserUid: string;
  credits: number;
  packId: string;
}

export type FulfillResult =
  | { fulfilled: true }
  | { duplicate: true }
  | { error: true; message: string };

export async function fulfillTopup(
  deps: FulfillTopupDeps,
  ev: TopupEvent,
): Promise<FulfillResult> {
  // ── Guard 1: bound the credits value itself ───────────────────────────────
  if (!Number.isInteger(ev.credits) || ev.credits <= 0 || ev.credits > 100_000) {
    return { error: true, message: "invalid_credits" };
  }

  // ── Guard 2: re-derive from CREDIT_PACKS — reject any disagreement ────────
  const pack = CREDIT_PACKS.find((p) => p.id === ev.packId);
  if (!pack || pack.credits !== ev.credits) {
    return { error: true, message: "pack_mismatch" };
  }

  // ── Guard 3: idempotency — a replayed/retried Stripe event must never mint
  // credits twice for the same checkout session ─────────────────────────────
  const isDuplicate = await deps.findTxnByReference(ev.sessionId);
  if (isDuplicate) return { duplicate: true };

  // ── Ensure the wallet exists (and is subAccountId-stamped) BEFORE crediting.
  // This must run before applyCredit — see the ensureWallet doc comment above.
  try {
    await deps.ensureWallet({
      walletId: ev.purchaserUid,
      agencyId: ev.agencyId,
      subAccountId: ev.subAccountId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ensure_wallet_failed";
    return { error: true, message };
  }

  const result = await deps.applyCredit({
    agencyId: ev.agencyId,
    partnerProfileId: ev.purchaserUid,
    delta: ev.credits,
    description: `Credit top-up: ${ev.packId} pack`,
    referenceId: ev.sessionId,
  });

  if ("error" in result) {
    return { error: true, message: result.message };
  }

  // Race-loser path: a concurrent Stripe webhook retry already minted this
  // transactionId first (tx.create ALREADY_EXISTS). Treat identically to the
  // pre-check duplicate path above — no double-mint, no error surfaced.
  if ("skipped" in result) {
    return { duplicate: true };
  }

  return { fulfilled: true };
}
