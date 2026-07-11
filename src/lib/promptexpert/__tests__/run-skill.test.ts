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
});
