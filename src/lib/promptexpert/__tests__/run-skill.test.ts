import { describe, expect, it, vi } from "vitest";
import { runSkill, type RunSkillDeps } from "../run-skill";

function makeDeps(over: Partial<RunSkillDeps> = {}): RunSkillDeps {
  return {
    loadSubAccount: async () => ({ agencyId: "ag1", planMode: "credit" }),
    loadSkill: async () => ({ id: "sk1", subAccountId: "sa1", systemInstruction: "Do [X] with @G", outputFormat: "Markdown", creditCost: 5, name: "Test" }),
    loadGems: async () => [{ name: "G", dataContent: "CTX" }],
    newRunId: () => "run1",
    writeRun: vi.fn(async () => {}),
    updateRun: vi.fn(async () => {}),
    charge: vi.fn(async () => ({ ok: true as const, transactionId: "tx1" })),
    refund: vi.fn(async () => {}),
    resolveAi: async () => ({ apiKey: "k", recordUsage: vi.fn(async () => {}) }),
    callModel: vi.fn(async () => ({ text: "OUT", totalTokens: 10, model: "m" })),
    masterAgencyId: undefined,
    ...over,
  };
}
const INPUT = { subAccountId: "sa1", uid: "u1", skillId: "sk1", variables: { X: "y" } };

describe("runSkill charge ladder", () => {
  it("charges credit-mode subs and returns output", async () => {
    const deps = makeDeps();
    const r = await runSkill(deps, INPUT);
    expect(r).toMatchObject({ ok: true, output: "OUT", creditsCharged: 5 });
    expect(deps.charge).toHaveBeenCalledWith(expect.objectContaining({ amount: 5, operationId: "ai_run_run1" }));
  });

  it("skips the charge for the master agency", async () => {
    const deps = makeDeps({ masterAgencyId: "ag1" });
    const r = await runSkill(deps, INPUT);
    expect(r).toMatchObject({ ok: true, creditsCharged: 0 });
    expect(deps.charge).not.toHaveBeenCalled();
  });

  it("returns 402 on insufficient balance without calling the model", async () => {
    const deps = makeDeps({ charge: vi.fn(async () => ({ insufficient_balance: true as const, currentBalance: 2, required: 5 })) });
    const r = await runSkill(deps, INPUT);
    expect(r).toMatchObject({ status: 402, currentBalance: 2, required: 5 });
    expect(deps.callModel).not.toHaveBeenCalled();
  });

  it("gates byok subs without the feature flag behind 403 upsell", async () => {
    const deps = makeDeps({ loadSubAccount: async () => ({ agencyId: "ag1", planMode: "byok" }) });
    const r = await runSkill(deps, INPUT);
    expect(r).toMatchObject({ status: 403, upsell: true });
  });

  it("lets byok subs WITH the feature flag run uncharged", async () => {
    const deps = makeDeps({ loadSubAccount: async () => ({ agencyId: "ag1", planMode: "byok", featurePromptExpert: true }) });
    const r = await runSkill(deps, INPUT);
    expect(r).toMatchObject({ ok: true, creditsCharged: 0 });
    expect(deps.charge).not.toHaveBeenCalled();
  });

  it("refunds the charge when the model call throws", async () => {
    const deps = makeDeps({ callModel: vi.fn(async () => { throw new Error("boom"); }) });
    const r = await runSkill(deps, INPUT);
    expect(r).toMatchObject({ status: 500 });
    expect(deps.refund).toHaveBeenCalledWith(expect.objectContaining({ amount: 5, referenceId: "ai_run_run1" }));
    expect(deps.updateRun).toHaveBeenCalledWith("run1", expect.objectContaining({ status: "failed" }));
  });

  it("404s when the skill belongs to a different sub-account", async () => {
    const deps = makeDeps({ loadSkill: async () => ({ id: "sk1", subAccountId: "OTHER", systemInstruction: "", outputFormat: "Markdown", creditCost: 1, name: "x" }) });
    const r = await runSkill(deps, INPUT);
    expect(r).toMatchObject({ status: 404 });
  });

  it("returns 402 when the wallet is not found, without calling the model", async () => {
    const deps = makeDeps({ charge: vi.fn(async () => ({ wallet_not_found: true as const })) });
    const r = await runSkill(deps, INPUT);
    expect(r).toMatchObject({ status: 402, currentBalance: 0, required: 5 });
    expect(deps.callModel).not.toHaveBeenCalled();
  });

  it("continues without double-charging when the charge is skipped as a duplicate", async () => {
    const deps = makeDeps({ charge: vi.fn(async () => ({ skipped: true as const })) });
    const r = await runSkill(deps, INPUT);
    expect(r).toMatchObject({ ok: true, creditsCharged: 0 });
    expect(deps.callModel).toHaveBeenCalled();
  });

  it("returns 500 on a charge error, without calling the model or refunding", async () => {
    const deps = makeDeps({ charge: vi.fn(async () => ({ error: true as const, message: "boom" })) });
    const r = await runSkill(deps, INPUT);
    expect(r).toMatchObject({ status: 500 });
    expect(deps.callModel).not.toHaveBeenCalled();
    expect(deps.refund).not.toHaveBeenCalled();
  });

  it("returns 429 on a token-cap error, refunding the charge already taken", async () => {
    const deps = makeDeps({
      resolveAi: async () => { throw Object.assign(new Error("cap"), { name: "CapExceededError" }); },
    });
    const r = await runSkill(deps, INPUT);
    expect(r).toMatchObject({ status: 429, error: "token_cap" });
    expect(deps.refund).toHaveBeenCalledWith(expect.objectContaining({ amount: 5 }));
  });

  it("surfaces unresolved variables and gems on an otherwise-ok result", async () => {
    const deps = makeDeps({
      loadSkill: async () => ({ id: "sk1", subAccountId: "sa1", systemInstruction: "Do [X] and [Y] with @Nope", outputFormat: "Markdown", creditCost: 5, name: "Test" }),
    });
    const r = await runSkill(deps, INPUT);
    expect(r).toMatchObject({ ok: true, missingVariables: ["Y"] });
    if ("missingGems" in r) {
      expect(r.missingGems.some((g) => g.includes("Nope"))).toBe(true);
    } else {
      throw new Error("expected an ok result with missingGems");
    }
  });

  it("does not refund a successful run when post-success bookkeeping throws", async () => {
    const deps = makeDeps({
      updateRun: vi.fn(async (_runId, patch: Record<string, unknown>) => {
        if (patch.status === "succeeded") throw new Error("firestore write failed");
      }),
    });
    const r = await runSkill(deps, INPUT);
    expect(r).toMatchObject({ ok: true, output: "OUT", creditsCharged: 5 });
    expect(deps.refund).not.toHaveBeenCalled();
  });
});
