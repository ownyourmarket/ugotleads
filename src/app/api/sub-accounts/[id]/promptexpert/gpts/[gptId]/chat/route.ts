import "server-only";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireSubAccountMember } from "@/lib/auth/require-tenancy";
import { spendCredits, serverApplyCreditDelta } from "@/lib/credits/server";
import { resolveAiCallContext, CapExceededError } from "@/lib/comms/ai/provider-resolver";
import { callAi } from "@/lib/comms/ai/openrouter";
import { runGptMessage, type RunGptDeps, type RunGptResult } from "@/lib/promptexpert/run-gpt-message";

/**
 * POST /api/sub-accounts/[id]/promptexpert/gpts/[gptId]/chat
 *
 * Credit-metered chat turn against a saved PromptExpert GPT. Wires the pure
 * `runGptMessage` engine (src/lib/promptexpert/run-gpt-message.ts) to the
 * real Firestore / credits / AI stack. Sibling of
 * `promptexpert/run/route.ts` — same auth/wallet/charge/refund/AI-context
 * wiring and the same `ai_runs` field-mapping conventions (`mapRunPatch`),
 * plus a `pe_gpt_sessions` adapter for conversation history.
 *
 * CRITICAL: the engine's `appendToSession` patch carries
 * `totalCreditsChargedDelta` — a per-message delta, not an absolute — so it
 * MUST be applied with `FieldValue.increment()`, never a plain set. The
 * `messages` field in that same patch IS a full replacement array (already
 * ring-buffer-trimmed by the engine) so a plain field write is correct for
 * it. `createSession`'s `totalCreditsCharged` is an absolute value — a
 * plain set is correct there.
 *
 * Reconciliation notes (mirrors run/route.ts): `ai_runs` docs written here
 * are enriched toward the real `AiRun` shape (src/types/ledger.ts) where a
 * mapping exists. Fields the engine's frozen contract can't supply
 * (promptTokens/completionTokens split, costMicrocents, a real
 * creditTransactionId) are written as documented placeholders.
 */

// Chat turns are conversational, not long-form generation — 1024 output
// tokens covers a normal reply without runaway per-message cost.
const PE_GPT_MAX_OUTPUT_TOKENS = 1024;

const MAX_MESSAGE_LENGTH = 4000;

const STATUS_MAP: Record<string, "pending" | "success" | "failed" | "timeout"> = {
  running: "pending",
  succeeded: "success",
  failed: "failed",
};

/**
 * Translate the engine's generic run-log vocabulary to the real AiRun
 * field names/values where one exists — copied from run/route.ts so both
 * routes stay in lockstep. See that file's `mapRunPatch` for the full
 * rationale on each remap.
 */
function mapRunPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch };
  if (typeof out.status === "string" && out.status in STATUS_MAP) {
    out.status = STATUS_MAP[out.status];
  }
  if ("error" in out) {
    out.errorMessage = out.error ?? null;
    delete out.error;
  }
  if ("source" in out) {
    // AiRunChannel has no PromptExpert-specific member yet; "other" is the
    // closest fit until one is added. `source` is kept alongside for
    // PE-internal filtering.
    out.channel = "other";
  }
  return out;
}

const PE_GPTS = "pe_gpts";
const PE_PROMPTS = "pe_prompts";
const PE_GEMS = "pe_gems";
const PE_GPT_SESSIONS = "pe_gpt_sessions";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; gptId: string }> },
) {
  const { id: subAccountId, gptId } = await ctx.params;
  const auth = await requireSubAccountMember(request, subAccountId);
  if (auth instanceof NextResponse) return auth;

  let body: { sessionId?: string | null; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (
    typeof body.message !== "string" ||
    body.message.length === 0 ||
    body.message.length > MAX_MESSAGE_LENGTH
  ) {
    return NextResponse.json({ error: "invalid_message" }, { status: 400 });
  }
  const userMessage = body.message;
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.length > 0 ? body.sessionId : null;

  const db = getAdminDb();

  // Memoized within this request — resolveAiCallContext etc. only need it
  // resolved once per subAccountId even though charge/refund/ai_runs
  // logging each want it.
  let partnerProfileIdCache: string | null | undefined;
  async function resolvePartnerProfileId(saId: string): Promise<string | null> {
    if (partnerProfileIdCache !== undefined) return partnerProfileIdCache;
    const q = await db.collection("credit_wallets").where("subAccountId", "==", saId).limit(1).get();
    partnerProfileIdCache = q.empty ? null : q.docs[0].id;
    return partnerProfileIdCache;
  }

  // AiRun.accessModel/agencyId — captured when loadSubAccount runs (the
  // engine has no writeRun dep, so the route logs ai_runs itself after the
  // engine returns and needs these fields cached from that lookup).
  let cachedAccessModel: "credit" | "subscription" | "byok" = "credit";
  let cachedAgencyId: string | null = null;

  const deps: RunGptDeps = {
    loadSubAccount: async (saId) => {
      const snap = await db.collection("subAccounts").doc(saId).get();
      if (!snap.exists) return null;
      const d = snap.data()!;
      cachedAgencyId = d.agencyId ?? null;
      if (d.planMode === "credit" || d.planMode === "subscription" || d.planMode === "byok") {
        cachedAccessModel = d.planMode;
      }
      return {
        agencyId: d.agencyId,
        planMode: d.planMode ?? null,
        featurePromptExpert: d.featurePromptExpert === true,
      };
    },
    loadGpt: async (id) => {
      const snap = await db.collection(PE_GPTS).doc(id).get();
      if (!snap.exists) return null;
      const d = snap.data()!;
      return {
        id: snap.id,
        subAccountId: d.subAccountId,
        name: d.name,
        basePromptId: d.basePromptId ?? null,
        pinnedGemIds: d.pinnedGemIds ?? [],
        creditCostPerMessage: d.creditCostPerMessage ?? 1,
      };
    },
    loadPromptContent: async (promptId) => {
      const snap = await db.collection(PE_PROMPTS).doc(promptId).get();
      if (!snap.exists) return null;
      return (snap.data()?.content as string) ?? null;
    },
    loadGemsByIds: async (ids) => {
      if (ids.length === 0) return [];
      const snaps = await db.getAll(...ids.map((gid) => db.collection(PE_GEMS).doc(gid)));
      return snaps
        .filter((s) => s.exists)
        .map((s) => ({ name: s.data()!.name as string, dataContent: s.data()!.dataContent as string }));
    },
    loadSession: async (id) => {
      const snap = await db.collection(PE_GPT_SESSIONS).doc(id).get();
      if (!snap.exists) return null;
      const d = snap.data()!;
      return {
        id: snap.id,
        gptId: d.gptId,
        subAccountId: d.subAccountId,
        messages: d.messages ?? [],
      };
    },
    createSession: async (data) => {
      const ref = db.collection(PE_GPT_SESSIONS).doc();
      // `totalCreditsCharged` here is the engine's absolute starting value —
      // a plain field in the initial set is correct (nothing to increment
      // against yet).
      await ref.set({
        ...data,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return ref.id;
    },
    appendToSession: async (id, patch) => {
      const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      // `messages` is a full replacement array (already ring-buffer-trimmed
      // by the engine) — a plain field write is correct.
      if ("messages" in patch) update.messages = patch.messages;
      // `totalCreditsChargedDelta` is a per-message DELTA, not an absolute —
      // MUST be applied via FieldValue.increment(), never overwritten.
      if ("totalCreditsChargedDelta" in patch) {
        update.totalCreditsCharged = FieldValue.increment(patch.totalCreditsChargedDelta as number);
      }
      await db.collection(PE_GPT_SESSIONS).doc(id).update(update);
    },
    newMessageId: () => db.collection("ai_runs").doc().id,
    charge: async (c) => {
      const partnerProfileId = await resolvePartnerProfileId(c.subAccountId);
      if (!partnerProfileId) return { wallet_not_found: true as const };
      return spendCredits({
        agencyId: c.agencyId,
        partnerProfileId,
        subAccountId: c.subAccountId,
        amount: c.amount,
        reason: c.reason,
        operationId: c.operationId,
        metadata: { source: "promptexpert_gpt" },
      });
    },
    refund: async (r) => {
      const partnerProfileId = await resolvePartnerProfileId(r.subAccountId);
      if (!partnerProfileId) return;
      await serverApplyCreditDelta({
        agencyId: r.agencyId,
        partnerProfileId,
        delta: r.amount,
        type: "refund",
        description: "PromptExpert GPT chat failed — refund",
        referenceId: r.referenceId,
      });
    },
    resolveAi: async (saId) => resolveAiCallContext(saId),
    callModel: async ({ apiKey, messages }) => {
      const r = await callAi({ apiKey, messages, maxTokens: PE_GPT_MAX_OUTPUT_TOKENS });
      return { text: r.text, totalTokens: r.totalTokens, model: r.model };
    },
    now: () => Date.now(),
    masterAgencyId: process.env.MASTER_AGENCY_ID,
  };

  let result: RunGptResult;
  try {
    result = await runGptMessage(deps, {
      subAccountId,
      uid: auth.uid,
      gptId,
      sessionId,
      userMessage,
    });
  } catch (err) {
    // Defense-in-depth: runGptMessage's own try/catch already intercepts
    // CapExceededError thrown by deps.resolveAi and translates it to a
    // { status: 429 } result, so this branch is not expected to fire for
    // that case — kept in case a future engine change lets errors escape.
    if (err instanceof CapExceededError) return NextResponse.json({ error: "token_cap" }, { status: 429 });
    console.error("[promptexpert/gpts/chat] failed:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  // Log this turn to ai_runs — best-effort, never fails the response.
  // Logged for the success path and for 402/429/500 (real failures worth an
  // audit trail); skipped for 403 (upsell gate, no run attempted) and 404
  // (bad ids, nothing ran).
  try {
    if ("ok" in result || result.status === 402 || result.status === 429 || result.status === 500) {
      const partnerProfileId = await resolvePartnerProfileId(subAccountId);
      const base = {
        agencyId: cachedAgencyId,
        subAccountId,
        gptId,
        source: "promptexpert_gpt",
        triggeredByUid: auth.uid,
        partnerProfileId,
        accessModel: cachedAccessModel,
        // No per-model rate table or prompt/completion split exists for
        // chat turns yet — cost accounting is a follow-up, same as the
        // run route's reconciliation notes.
        promptTokens: 0,
        completionTokens: 0,
        costMicrocents: 0,
        creditTransactionId: null,
        createdAt: FieldValue.serverTimestamp(),
      };
      if ("ok" in result) {
        await db.collection("ai_runs").add(
          mapRunPatch({
            ...base,
            status: "succeeded",
            model: result.model,
            creditsCharged: result.creditsCharged,
            // The engine returns only a combined totalTokens via
            // ai.recordUsage(), not on the result itself — recorded as 0
            // until the engine's contract carries it through.
            totalTokens: 0,
            error: null,
          }),
        );
      } else {
        const errorMessage =
          result.status === 402
            ? `insufficient_credits: balance=${result.currentBalance}, required=${result.required}`
            : result.error;
        await db.collection("ai_runs").add(
          mapRunPatch({
            ...base,
            status: "failed",
            model: "",
            creditsCharged: 0,
            totalTokens: 0,
            error: errorMessage,
          }),
        );
      }
    }
  } catch (logErr) {
    console.error("[promptexpert/gpts/chat] ai_runs logging failed:", logErr);
  }

  if ("ok" in result) {
    return NextResponse.json({
      sessionId: result.sessionId,
      reply: result.reply,
      creditsCharged: result.creditsCharged,
      model: result.model,
    });
  }
  if (result.status === 402)
    return NextResponse.json(
      { error: "insufficient_credits", currentBalance: result.currentBalance, required: result.required },
      { status: 402 },
    );
  if (result.status === 403) return NextResponse.json({ error: "upsell_required", upsell: true }, { status: 403 });
  if (result.status === 404) return NextResponse.json({ error: result.error }, { status: 404 });
  if (result.status === 429) return NextResponse.json({ error: "token_cap" }, { status: 429 });
  return NextResponse.json({ error: result.error }, { status: 500 });
}
