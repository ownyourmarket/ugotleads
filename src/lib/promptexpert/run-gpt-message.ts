import { buildGptSystemPrompt } from "./gpt-prompt";
import { PE_GPT_SESSION_MAX_MESSAGES } from "@/types/promptexpert";

export interface RunGptDeps {
  loadSubAccount(subAccountId: string): Promise<{ agencyId: string; planMode: "credit" | "subscription" | "byok" | null; featurePromptExpert?: boolean } | null>;
  loadGpt(gptId: string): Promise<{ id: string; subAccountId: string; name: string; basePromptId: string | null; pinnedGemIds: string[]; creditCostPerMessage: number } | null>;
  loadPromptContent(promptId: string): Promise<string | null>;        // pe_prompts content, null if missing
  loadGemsByIds(ids: string[]): Promise<Array<{ name: string; dataContent: string }>>;
  loadSession(sessionId: string): Promise<{ id: string; gptId: string; subAccountId: string; messages: Array<{ role: "user" | "assistant"; content: string; at: number }> } | null>;
  createSession(data: Record<string, unknown>): Promise<string>;      // returns new session id
  appendToSession(sessionId: string, patch: Record<string, unknown>): Promise<void>;
  newMessageId(): string;                                             // for charge idempotency
  charge(input: { agencyId: string; subAccountId: string; amount: number; operationId: string; reason: string }): Promise<
    | { ok: true; transactionId: string } | { skipped: true }
    | { insufficient_balance: true; currentBalance: number; required: number }
    | { wallet_not_found: true } | { error: true; message: string }>;
  refund(input: { agencyId: string; subAccountId: string; amount: number; referenceId: string }): Promise<void>;
  resolveAi(subAccountId: string): Promise<{ apiKey: string; recordUsage(t: number): Promise<void> }>;
  callModel(input: { apiKey: string; messages: Array<{ role: "system" | "user" | "assistant"; content: string }> }): Promise<{ text: string; totalTokens: number; model: string }>;
  now(): number;                                                      // epoch ms (injected — engines stay clock-pure)
  masterAgencyId: string | undefined;
}

export type RunGptResult =
  | { ok: true; sessionId: string; reply: string; creditsCharged: number; model: string }
  | { status: 402; currentBalance: number; required: number }
  | { status: 403; upsell: true }
  | { status: 404; error: string }
  | { status: 429; error: "token_cap" }
  | { status: 500; error: string };

export async function runGptMessage(deps: RunGptDeps, input: {
  subAccountId: string; uid: string; gptId: string;
  sessionId: string | null;          // null = start new session
  userMessage: string;
}): Promise<RunGptResult> {
  const sub = await deps.loadSubAccount(input.subAccountId);
  if (!sub) return { status: 404, error: "sub_account_not_found" };

  const gpt = await deps.loadGpt(input.gptId);
  if (!gpt || gpt.subAccountId !== input.subAccountId)
    return { status: 404, error: "gpt_not_found" };

  let session: { id: string; gptId: string; subAccountId: string; messages: Array<{ role: "user" | "assistant"; content: string; at: number }> } | null = null;
  if (input.sessionId) {
    session = await deps.loadSession(input.sessionId);
    if (!session || session.gptId !== input.gptId || session.subAccountId !== input.subAccountId)
      return { status: 404, error: "session_not_found" };
  }

  const isMaster = !!deps.masterAgencyId && sub.agencyId === deps.masterAgencyId;

  // BYOK entitlement gate (masters bypass) — before ANY write/charge.
  if (!isMaster && sub.planMode === "byok" && sub.featurePromptExpert !== true)
    return { status: 403, upsell: true };

  const messageId = deps.newMessageId();
  const operationId = `gpt_msg_${messageId}`;

  // Charge ladder (mirrors run-skill.ts): master → free; "credit" → charged per
  // message; "byok" → entitlement-gated, uncharged; "subscription" AND null
  // (legacy default) → INCLUDED: uncharged, metered by the monthly token cap only.
  const shouldCharge = !isMaster && sub.planMode === "credit" && gpt.creditCostPerMessage > 0;
  let creditsCharged = 0;
  if (shouldCharge) {
    const c = await deps.charge({
      agencyId: sub.agencyId, subAccountId: input.subAccountId,
      amount: gpt.creditCostPerMessage, operationId, reason: `PromptExpert GPT: ${gpt.name}`,
    });
    if ("insufficient_balance" in c)
      return { status: 402, currentBalance: c.currentBalance, required: c.required };
    if ("wallet_not_found" in c)
      return { status: 402, currentBalance: 0, required: gpt.creditCostPerMessage };
    if ("error" in c)
      return { status: 500, error: c.message };
    if ("ok" in c) creditsCharged = gpt.creditCostPerMessage;
    // "skipped" (duplicate operationId) ⇒ already charged for this message; continue.
  }

  const basePromptContent = gpt.basePromptId ? await deps.loadPromptContent(gpt.basePromptId) : null;
  const gems = await deps.loadGemsByIds(gpt.pinnedGemIds);
  const systemPrompt = buildGptSystemPrompt({ basePromptContent, gptName: gpt.name, gems });

  const history = session ? session.messages.slice(-PE_GPT_SESSION_MAX_MESSAGES) : [];
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userMessage },
  ];

  try {
    const ai = await deps.resolveAi(input.subAccountId);
    const result = await deps.callModel({ apiKey: ai.apiKey, messages });

    // Bookkeeping after a successful model call must never turn a successful
    // message into a reported failure. If session/usage writes throw here, log
    // it but still return the ok result — the charge already succeeded and
    // must not be refunded for a message that actually produced a reply.
    let sessionId = session ? session.id : "";
    try {
      const at = deps.now();
      const userMsg = { role: "user" as const, content: input.userMessage, at };
      const assistantMsg = { role: "assistant" as const, content: result.text, at };
      if (session) {
        const updatedMessages = [...session.messages, userMsg, assistantMsg].slice(-PE_GPT_SESSION_MAX_MESSAGES);
        // totalCreditsChargedDelta: the route MUST apply this via FieldValue.increment() — it is a per-message delta, not an absolute.
        await deps.appendToSession(session.id, {
          messages: updatedMessages,
          totalCreditsChargedDelta: creditsCharged,
        });
      } else {
        sessionId = await deps.createSession({
          agencyId: sub.agencyId, subAccountId: input.subAccountId, gptId: input.gptId,
          startedByUid: input.uid, messages: [userMsg, assistantMsg].slice(-PE_GPT_SESSION_MAX_MESSAGES),
          totalCreditsCharged: creditsCharged,
        });
      }
      await ai.recordUsage(result.totalTokens);
    } catch (bookkeepingErr) {
      console.error("[promptexpert] gpt post-success bookkeeping failed:", bookkeepingErr);
    }

    return { ok: true, sessionId, reply: result.text, creditsCharged, model: result.model };
  } catch (err) {
    if (creditsCharged > 0) {
      await deps.refund({
        agencyId: sub.agencyId, subAccountId: input.subAccountId,
        amount: creditsCharged, referenceId: operationId,
      });
    }
    const message = err instanceof Error ? err.message : "run_failed";
    // Token-cap errors surface as 429. CapExceededError is thrown by
    // deps.resolveAi (see the provider resolver); we match on the exact
    // error name here (not a substring check) rather than importing the
    // class, keeping this engine free of framework-specific dependencies.
    if (err instanceof Error && err.name === "CapExceededError")
      return { status: 429, error: "token_cap" };
    return { status: 500, error: message };
  }
}
