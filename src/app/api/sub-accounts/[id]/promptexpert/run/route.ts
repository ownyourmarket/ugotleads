import "server-only";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireSubAccountMember } from "@/lib/auth/require-tenancy";
import { spendCredits, serverApplyCreditDelta } from "@/lib/credits/server";
import { resolveAiCallContext, CapExceededError } from "@/lib/comms/ai/provider-resolver";
import { callAi } from "@/lib/comms/ai/openrouter";
import { runSkill, type RunSkillDeps } from "@/lib/promptexpert/run-skill";

/**
 * POST /api/sub-accounts/[id]/promptexpert/run
 *
 * Credit-metered execution of a PromptExpert skill. Wires the pure
 * `runSkill` engine (src/lib/promptexpert/run-skill.ts) to the real
 * Firestore / credits / AI stack.
 *
 * Reconciliation notes (see task-9-report.md for the full list):
 *  - `ai_runs` docs written here are enriched to match the real `AiRun`
 *    shape (src/types/ledger.ts) where a mapping exists: status values
 *    are translated ("running"→"pending", "succeeded"→"success"),
 *    `error`→`errorMessage`, and `partnerProfileId`/`accessModel` are
 *    resolved even though the engine's dependency-injected contract
 *    doesn't carry them.
 *  - Fields the engine's frozen, tested contract cannot supply
 *    (promptTokens/completionTokens split, costMicrocents, a
 *    PromptExpert-specific AiRunChannel) are written as documented
 *    placeholders — see the report.
 */

// PromptExpert generates long-form content; the SMS-tuned callAi default (400) truncates it.
const PE_MAX_OUTPUT_TOKENS = 2048;

const STATUS_MAP: Record<string, "pending" | "success" | "failed" | "timeout"> = {
  running: "pending",
  succeeded: "success",
  failed: "failed",
};

/**
 * Translate the engine's generic run-log vocabulary to the real AiRun
 * field names/values where one exists. Fields with no AiRun equivalent
 * (source, skillId, skillName, triggeredByUid, output) are left as-is —
 * Firestore has no schema enforcement, so they're harmless PE-specific
 * extras riding alongside the ledger-compliant fields.
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

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: subAccountId } = await ctx.params;
  const auth = await requireSubAccountMember(request, subAccountId);
  if (auth instanceof NextResponse) return auth;

  let body: { skillId?: string; variables?: Record<string, string> };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body.skillId) return NextResponse.json({ error: "skillId_required" }, { status: 400 });

  const db = getAdminDb();

  // Memoized within this request — resolveAiCallContext etc. only need it
  // resolved once per subAccountId even though writeRun/updateRun/charge/
  // refund each want it.
  let partnerProfileIdCache: string | null | undefined;
  async function resolvePartnerProfileId(saId: string): Promise<string | null> {
    if (partnerProfileIdCache !== undefined) return partnerProfileIdCache;
    const q = await db.collection("credit_wallets").where("subAccountId", "==", saId).limit(1).get();
    partnerProfileIdCache = q.empty ? null : q.docs[0].id;
    return partnerProfileIdCache;
  }

  // AiRun.accessModel mirrors subAccount.planMode 1:1 (PlanMode and
  // AccessModel are the same three literals) — captured when loadSubAccount
  // runs so writeRun/updateRun can stamp it on the ai_runs doc.
  let cachedAccessModel: "credit" | "subscription" | "byok" = "credit";

  const deps: RunSkillDeps = {
    loadSubAccount: async (saId) => {
      const snap = await db.collection("subAccounts").doc(saId).get();
      if (!snap.exists) return null;
      const d = snap.data()!;
      if (d.planMode === "credit" || d.planMode === "subscription" || d.planMode === "byok") {
        cachedAccessModel = d.planMode;
      }
      return { agencyId: d.agencyId, planMode: d.planMode ?? null, featurePromptExpert: d.featurePromptExpert === true };
    },
    loadSkill: async (skillId) => {
      const snap = await db.collection("pe_skills").doc(skillId).get();
      if (!snap.exists) return null;
      const d = snap.data()!;
      return { id: snap.id, subAccountId: d.subAccountId, systemInstruction: d.systemInstruction, outputFormat: d.outputFormat, creditCost: d.creditCost, name: d.name };
    },
    loadGems: async (saId) => {
      const q = await db.collection("pe_gems").where("subAccountId", "==", saId).get();
      return q.docs.map((g) => ({ name: g.data().name as string, dataContent: g.data().dataContent as string }));
    },
    newRunId: () => db.collection("ai_runs").doc().id,
    writeRun: async (runId, data) => {
      const saId = data.subAccountId as string;
      const partnerProfileId = await resolvePartnerProfileId(saId);
      const mapped = mapRunPatch(data);
      await db.collection("ai_runs").doc(runId).set({
        ...mapped,
        partnerProfileId,
        accessModel: cachedAccessModel,
        // AiRun requires these non-optional; real values land via the
        // updateRun patch once the model call resolves.
        model: "",
        totalTokens: 0,
        creditTransactionId: null,
        promptTokens: 0,
        completionTokens: 0,
        // No per-model rate table exists yet — cost accounting is a
        // follow-up; see reconciliation notes.
        costMicrocents: 0,
        errorMessage: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    },
    updateRun: async (runId, patch) => {
      const mapped = mapRunPatch(patch);
      await db.collection("ai_runs").doc(runId).update({
        ...mapped,
        updatedAt: FieldValue.serverTimestamp(),
      });
    },
    charge: async (c) => {
      const partnerProfileId = await resolvePartnerProfileId(c.subAccountId);
      if (!partnerProfileId) return { wallet_not_found: true as const };
      return spendCredits({
        agencyId: c.agencyId, partnerProfileId, subAccountId: c.subAccountId,
        amount: c.amount, reason: c.reason, operationId: c.operationId,
        metadata: { source: "promptexpert" },
      });
    },
    refund: async (r) => {
      const partnerProfileId = await resolvePartnerProfileId(r.subAccountId);
      if (!partnerProfileId) return;
      await serverApplyCreditDelta({
        agencyId: r.agencyId, partnerProfileId, delta: r.amount,
        type: "refund", description: "PromptExpert run failed — refund",
        referenceId: r.referenceId,
      });
    },
    resolveAi: async (saId) => resolveAiCallContext(saId),
    callModel: async ({ apiKey, system, outputFormat }) => {
      const r = await callAi({
        apiKey,
        messages: [
          { role: "system", content: `${system}\n\nRespond in ${outputFormat} format only.` },
          { role: "user", content: "Execute the instruction above." },
        ],
        maxTokens: PE_MAX_OUTPUT_TOKENS,
      });
      return { text: r.text, totalTokens: r.totalTokens, model: r.model };
    },
    masterAgencyId: process.env.MASTER_AGENCY_ID,
  };

  try {
    const result = await runSkill(deps, {
      subAccountId, uid: auth.uid, skillId: body.skillId, variables: body.variables ?? {},
    });
    if ("ok" in result) return NextResponse.json(result);
    if (result.status === 402) return NextResponse.json({ error: "insufficient_credits", currentBalance: result.currentBalance, required: result.required }, { status: 402 });
    if (result.status === 403) return NextResponse.json({ error: "upsell_required", upsell: true }, { status: 403 });
    if (result.status === 404) return NextResponse.json({ error: result.error }, { status: 404 });
    if (result.status === 429) return NextResponse.json({ error: "token_cap" }, { status: 429 });
    return NextResponse.json({ error: result.error }, { status: 500 });
  } catch (err) {
    // Defense-in-depth: runSkill's own try/catch already intercepts
    // CapExceededError thrown by deps.resolveAi and translates it to a
    // { status: 429 } result, so this branch is not expected to fire for
    // that case — kept in case a future engine change lets errors escape.
    if (err instanceof CapExceededError) return NextResponse.json({ error: "token_cap" }, { status: 429 });
    console.error("[promptexpert/run] failed:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
