import { describe, expect, it, vi } from "vitest";
import { runGptMessage, type RunGptDeps } from "../run-gpt-message";

function makeDeps(over: Partial<RunGptDeps> = {}): RunGptDeps {
  return {
    loadSubAccount: async () => ({ agencyId: "ag1", planMode: "credit" }),
    loadGpt: async () => ({
      id: "gpt1", subAccountId: "sa1", name: "Ada", basePromptId: null,
      pinnedGemIds: [], creditCostPerMessage: 3,
    }),
    loadPromptContent: async () => null,
    loadGemsByIds: async () => [],
    loadSession: async () => ({ id: "sess1", gptId: "gpt1", subAccountId: "sa1", messages: [] }),
    createSession: vi.fn(async () => "newSess1"),
    appendToSession: vi.fn(async () => {}),
    newMessageId: () => "msg1",
    charge: vi.fn(async () => ({ ok: true as const, transactionId: "tx1" })),
    refund: vi.fn(async () => {}),
    resolveAi: async () => ({ apiKey: "k", recordUsage: vi.fn(async () => {}) }),
    callModel: vi.fn(async () => ({ text: "REPLY", totalTokens: 10, model: "m" })),
    now: () => 1000,
    masterAgencyId: undefined,
    ...over,
  };
}

const INPUT = { subAccountId: "sa1", uid: "u1", gptId: "gpt1", sessionId: "sess1", userMessage: "hi" };

describe("runGptMessage charge ladder", () => {
  it("charges credit-mode subs and returns the reply", async () => {
    const deps = makeDeps();
    const r = await runGptMessage(deps, INPUT);
    expect(r).toMatchObject({ ok: true, reply: "REPLY", creditsCharged: 3 });
    expect(deps.charge).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 3, operationId: "gpt_msg_msg1" })
    );
  });

  it("skips the charge for the master agency", async () => {
    const deps = makeDeps({ masterAgencyId: "ag1" });
    const r = await runGptMessage(deps, INPUT);
    expect(r).toMatchObject({ ok: true, creditsCharged: 0 });
    expect(deps.charge).not.toHaveBeenCalled();
  });

  it("treats null planMode (legacy) as included: uncharged, run proceeds", async () => {
    const deps = makeDeps({ loadSubAccount: async () => ({ agencyId: "ag1", planMode: null }) });
    const r = await runGptMessage(deps, INPUT);
    expect(r).toMatchObject({ ok: true, creditsCharged: 0 });
    expect(deps.charge).not.toHaveBeenCalled();
    expect(deps.callModel).toHaveBeenCalled();
  });

  it("gates byok subs without the feature flag behind 403 upsell, before any charge/write", async () => {
    const deps = makeDeps({ loadSubAccount: async () => ({ agencyId: "ag1", planMode: "byok" }) });
    const r = await runGptMessage(deps, INPUT);
    expect(r).toMatchObject({ status: 403, upsell: true });
    expect(deps.charge).not.toHaveBeenCalled();
    expect(deps.callModel).not.toHaveBeenCalled();
    expect(deps.appendToSession).not.toHaveBeenCalled();
    expect(deps.createSession).not.toHaveBeenCalled();
  });

  it("lets byok subs WITH the feature flag run uncharged", async () => {
    const deps = makeDeps({
      loadSubAccount: async () => ({ agencyId: "ag1", planMode: "byok", featurePromptExpert: true }),
    });
    const r = await runGptMessage(deps, INPUT);
    expect(r).toMatchObject({ ok: true, creditsCharged: 0 });
    expect(deps.charge).not.toHaveBeenCalled();
  });

  it("returns 402 on insufficient balance without calling the model", async () => {
    const deps = makeDeps({
      charge: vi.fn(async () => ({ insufficient_balance: true as const, currentBalance: 1, required: 3 })),
    });
    const r = await runGptMessage(deps, INPUT);
    expect(r).toMatchObject({ status: 402, currentBalance: 1, required: 3 });
    expect(deps.callModel).not.toHaveBeenCalled();
  });

  it("refunds the charge when the model call throws", async () => {
    const deps = makeDeps({ callModel: vi.fn(async () => { throw new Error("boom"); }) });
    const r = await runGptMessage(deps, INPUT);
    expect(r).toMatchObject({ status: 500 });
    expect(deps.refund).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 3, referenceId: "gpt_msg_msg1" })
    );
  });

  it("returns 429 on a token-cap error, refunding the charge already taken", async () => {
    const deps = makeDeps({
      resolveAi: async () => { throw Object.assign(new Error("cap"), { name: "CapExceededError" }); },
    });
    const r = await runGptMessage(deps, INPUT);
    expect(r).toMatchObject({ status: 429, error: "token_cap" });
    expect(deps.refund).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 3, referenceId: "gpt_msg_msg1" })
    );
  });

  it("new session: createSession throws → ok:true, creditsCharged set, refund NOT called, sessionId empty", async () => {
    const deps = makeDeps({
      createSession: vi.fn(async () => { throw new Error("firestore error"); }),
    });
    const inputNewSession = { ...INPUT, sessionId: null };
    const r = await runGptMessage(deps, inputNewSession);
    expect(r).toMatchObject({ ok: true, creditsCharged: 3, sessionId: "" });
    expect(deps.refund).not.toHaveBeenCalled();
  });

  it("zero-cost gpt with credit mode → not charged, callModel called", async () => {
    const deps = makeDeps({
      loadGpt: async () => ({
        id: "gpt1", subAccountId: "sa1", name: "Ada", basePromptId: null,
        pinnedGemIds: [], creditCostPerMessage: 0,
      }),
    });
    const r = await runGptMessage(deps, INPUT);
    expect(r).toMatchObject({ ok: true, creditsCharged: 0 });
    expect(deps.charge).not.toHaveBeenCalled();
    expect(deps.callModel).toHaveBeenCalled();
  });

  it("404s when the gpt belongs to a different sub-account", async () => {
    const deps = makeDeps({
      loadGpt: async () => ({
        id: "gpt1", subAccountId: "OTHER", name: "Ada", basePromptId: null,
        pinnedGemIds: [], creditCostPerMessage: 3,
      }),
    });
    const r = await runGptMessage(deps, INPUT);
    expect(r).toMatchObject({ status: 404 });
  });

  it("404s when the session belongs to a different gpt", async () => {
    const deps = makeDeps({
      loadSession: async () => ({ id: "sess1", gptId: "OTHER_GPT", subAccountId: "sa1", messages: [] }),
    });
    const r = await runGptMessage(deps, INPUT);
    expect(r).toMatchObject({ status: 404 });
  });

  it("does not refund a successful run when post-success bookkeeping throws", async () => {
    const deps = makeDeps({
      appendToSession: vi.fn(async () => { throw new Error("firestore write failed"); }),
    });
    const r = await runGptMessage(deps, INPUT);
    expect(r).toMatchObject({ ok: true, reply: "REPLY", creditsCharged: 3 });
    expect(deps.refund).not.toHaveBeenCalled();
  });
});
