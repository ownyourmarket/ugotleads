import { resolveMentions } from "./resolve-mentions";

export interface RunSkillDeps {
  loadSubAccount(subAccountId: string): Promise<{ agencyId: string; planMode: "credit" | "subscription" | "byok" | null; featurePromptExpert?: boolean } | null>;
  loadSkill(skillId: string): Promise<{ id: string; subAccountId: string; systemInstruction: string; outputFormat: string; creditCost: number; name: string } | null>;
  loadGems(subAccountId: string): Promise<Array<{ name: string; dataContent: string }>>;
  newRunId(): string;
  writeRun(runId: string, data: Record<string, unknown>): Promise<void>;
  updateRun(runId: string, patch: Record<string, unknown>): Promise<void>;
  charge(input: { agencyId: string; subAccountId: string; amount: number; operationId: string; reason: string }): Promise<
    | { ok: true; transactionId: string }
    | { skipped: true } | { insufficient_balance: true; currentBalance: number; required: number }
    | { wallet_not_found: true } | { error: true; message: string }>;
  refund(input: { agencyId: string; subAccountId: string; amount: number; referenceId: string }): Promise<void>;
  resolveAi(subAccountId: string): Promise<{ apiKey: string; recordUsage(t: number): Promise<void> }>;
  callModel(input: { apiKey: string; system: string; outputFormat: string }): Promise<{
    text: string; totalTokens: number; model: string;
    promptTokens?: number; completionTokens?: number;
  }>;
  masterAgencyId: string | undefined;
}

export type RunSkillResult =
  | {
      ok: true; runId: string; output: string; creditsCharged: number; model: string;
      /** Variable names referenced (via `[Name]`) but not supplied in `input.variables`. */
      missingVariables: string[];
      /** `@Mention`s in the instruction that matched no gem. */
      missingGems: string[];
    }
  | { status: 402; currentBalance: number; required: number }
  | { status: 403; upsell: true }
  | { status: 404; error: string }
  | { status: 429; error: "token_cap" }
  | { status: 500; error: string };

export async function runSkill(deps: RunSkillDeps, input: {
  subAccountId: string; uid: string; skillId: string; variables: Record<string, string>;
}): Promise<RunSkillResult> {
  const sub = await deps.loadSubAccount(input.subAccountId);
  if (!sub) return { status: 404, error: "sub_account_not_found" };

  const skill = await deps.loadSkill(input.skillId);
  if (!skill || skill.subAccountId !== input.subAccountId)
    return { status: 404, error: "skill_not_found" };

  const isMaster = !!deps.masterAgencyId && sub.agencyId === deps.masterAgencyId;

  // BYOK entitlement gate (masters bypass).
  if (!isMaster && sub.planMode === "byok" && sub.featurePromptExpert !== true)
    return { status: 403, upsell: true };

  const gems = await deps.loadGems(input.subAccountId);
  const { resolved, missingVariables, missingGems } = resolveMentions({
    content: skill.systemInstruction, gems, variables: input.variables,
  });

  const runId = deps.newRunId();
  const operationId = `ai_run_${runId}`;
  await deps.writeRun(runId, {
    agencyId: sub.agencyId, subAccountId: input.subAccountId,
    source: "promptexpert", skillId: skill.id, skillName: skill.name,
    triggeredByUid: input.uid, status: "running", creditsCharged: 0,
  });

  // Charge ladder (decided 2026-07-11): master → free; "credit" → charged per run;
  // "byok" → entitlement-gated, uncharged; "subscription" AND null (legacy default,
  // see types/tenancy.ts PlanMode) → INCLUDED: uncharged, metered by the monthly
  // token cap only. Null is a deliberate inclusion, not an accident.
  const shouldCharge = !isMaster && sub.planMode === "credit" && skill.creditCost > 0;
  let creditsCharged = 0;
  let creditTransactionId: string | null = null;
  if (shouldCharge) {
    const c = await deps.charge({
      agencyId: sub.agencyId, subAccountId: input.subAccountId,
      amount: skill.creditCost, operationId, reason: `PromptExpert: ${skill.name}`,
    });
    if ("insufficient_balance" in c) {
      await deps.updateRun(runId, { status: "failed", error: "insufficient_credits" });
      return { status: 402, currentBalance: c.currentBalance, required: c.required };
    }
    if ("wallet_not_found" in c) {
      await deps.updateRun(runId, { status: "failed", error: "wallet_not_found" });
      return { status: 402, currentBalance: 0, required: skill.creditCost };
    }
    if ("error" in c) {
      await deps.updateRun(runId, { status: "failed", error: c.message });
      return { status: 500, error: c.message };
    }
    if ("ok" in c) {
      creditsCharged = skill.creditCost; creditTransactionId = c.transactionId;
      // Stamp the charge onto the run doc immediately — if the model call
      // fails below, the failure-path updateRun only patches status/error,
      // so this keeps the run forensically linked to the transaction that
      // paid for it even when the run itself ends up "failed".
      await deps.updateRun(runId, { creditsCharged, creditTransactionId });
    }
    // "skipped" (duplicate operationId) ⇒ already charged for this runId; continue.
  }

  try {
    const ai = await deps.resolveAi(input.subAccountId);
    const result = await deps.callModel({
      apiKey: ai.apiKey, system: resolved, outputFormat: skill.outputFormat,
    });
    // Bookkeeping after a successful model call must never turn a
    // successful run into a reported failure. If recordUsage/updateRun
    // throws here, log it but still return the ok result to the caller —
    // the credit charge already succeeded and must not be refunded for a
    // run that actually produced output.
    try {
      await ai.recordUsage(result.totalTokens);
      await deps.updateRun(runId, {
        status: "succeeded", output: result.text, totalTokens: result.totalTokens,
        model: result.model, creditsCharged, creditTransactionId,
        promptTokens: result.promptTokens ?? 0, completionTokens: result.completionTokens ?? 0,
      });
    } catch (bookkeepingErr) {
      console.error("[promptexpert] post-success bookkeeping failed:", bookkeepingErr);
    }
    return { ok: true, runId, output: result.text, creditsCharged, model: result.model, missingVariables, missingGems };
  } catch (err) {
    if (creditsCharged > 0) {
      await deps.refund({
        agencyId: sub.agencyId, subAccountId: input.subAccountId,
        amount: creditsCharged, referenceId: operationId,
      });
    }
    const message = err instanceof Error ? err.message : "run_failed";
    await deps.updateRun(runId, { status: "failed", error: message });
    // Token-cap errors surface as 429. CapExceededError is thrown by
    // deps.resolveAi (see the provider resolver); we match on the exact
    // error name here (not a substring check) rather than importing the
    // class, keeping this engine free of framework-specific dependencies.
    if (err instanceof Error && err.name === "CapExceededError")
      return { status: 429, error: "token_cap" };
    return { status: 500, error: message };
  }
}
