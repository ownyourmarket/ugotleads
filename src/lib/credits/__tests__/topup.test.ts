import { describe, expect, it, vi } from "vitest";
import { fulfillTopup, type FulfillTopupDeps, type TopupEvent } from "../topup";

function makeDeps(over: Partial<FulfillTopupDeps> = {}): FulfillTopupDeps {
  return {
    findTxnByReference: vi.fn(async () => false),
    ensureWallet: vi.fn(async () => {}),
    applyCredit: vi.fn(async () => ({ ok: true as const })),
    ...over,
  };
}

const EVENT: TopupEvent = {
  sessionId: "cs_test_1",
  agencyId: "ag1",
  subAccountId: "sa1",
  purchaserUid: "uid1",
  credits: 500,
  packId: "starter",
};

describe("fulfillTopup", () => {
  it("mints credits on the happy path, stamping subAccountId before crediting", async () => {
    const deps = makeDeps();
    const r = await fulfillTopup(deps, EVENT);
    expect(r).toEqual({ fulfilled: true });
    expect(deps.ensureWallet).toHaveBeenCalledWith({
      walletId: "uid1",
      agencyId: "ag1",
      subAccountId: "sa1",
    });
    expect(deps.applyCredit).toHaveBeenCalledWith({
      agencyId: "ag1",
      partnerProfileId: "uid1",
      delta: 500,
      description: "Credit top-up: starter pack",
      referenceId: "cs_test_1",
    });
  });

  it("no-ops on a duplicate sessionId — no wallet or credit writes", async () => {
    const deps = makeDeps({ findTxnByReference: vi.fn(async () => true) });
    const r = await fulfillTopup(deps, EVENT);
    expect(r).toEqual({ duplicate: true });
    expect(deps.ensureWallet).not.toHaveBeenCalled();
    expect(deps.applyCredit).not.toHaveBeenCalled();
  });

  it("rejects when metadata credits disagree with the pack's real credit amount", async () => {
    const deps = makeDeps();
    const r = await fulfillTopup(deps, { ...EVENT, credits: 999 });
    expect(r).toMatchObject({ error: true, message: "pack_mismatch" });
    expect(deps.ensureWallet).not.toHaveBeenCalled();
    expect(deps.applyCredit).not.toHaveBeenCalled();
  });

  it("rejects non-positive, non-integer, or oversized credits before touching the pack", async () => {
    const deps = makeDeps();

    const zero = await fulfillTopup(deps, { ...EVENT, credits: 0 });
    expect(zero).toMatchObject({ error: true });

    const negative = await fulfillTopup(deps, { ...EVENT, credits: -5 });
    expect(negative).toMatchObject({ error: true });

    const tooLarge = await fulfillTopup(deps, {
      ...EVENT,
      packId: "scale",
      credits: 200_000,
    });
    expect(tooLarge).toMatchObject({ error: true });

    expect(deps.ensureWallet).not.toHaveBeenCalled();
    expect(deps.applyCredit).not.toHaveBeenCalled();
  });

  it("propagates an applyCredit error without swallowing the message", async () => {
    const deps = makeDeps({
      applyCredit: vi.fn(async () => ({ error: true as const, message: "firestore boom" })),
    });
    const r = await fulfillTopup(deps, EVENT);
    expect(r).toEqual({ error: true, message: "firestore boom" });
  });

  it("propagates an ensureWallet throw as an error result, never reaching applyCredit", async () => {
    const deps = makeDeps({
      ensureWallet: vi.fn(async () => {
        throw new Error("wallet write failed");
      }),
    });
    const r = await fulfillTopup(deps, EVENT);
    expect(r).toMatchObject({ error: true });
    expect(deps.applyCredit).not.toHaveBeenCalled();
  });

  it("maps a race-loser applyCredit result ({skipped:true}) to {duplicate:true}", async () => {
    // This is the concurrent-webhook-retry path: the pre-check (findTxnByReference)
    // saw no existing transaction, but by the time applyCredit's tx.create runs,
    // another retry already won the mint on the same deterministic transactionId.
    const deps = makeDeps({
      applyCredit: vi.fn(async () => ({ skipped: true as const })),
    });
    const r = await fulfillTopup(deps, EVENT);
    expect(r).toEqual({ duplicate: true });
  });
});
