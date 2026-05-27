import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  publishCallback,
  verifyQStashSignature,
} from "@/lib/automations/qstash";
import { callAi } from "@/lib/comms/ai/openrouter";
import {
  resolveAiCallContext,
  CapExceededError,
  ByokKeyMissingError,
} from "@/lib/comms/ai/provider-resolver";
import {
  buildSystemPrompt,
  buildWeekPrompt,
} from "@/lib/social-content/prompts";
import {
  enforcePlatformLimits,
  parseGeneratedPosts,
} from "@/lib/social-content/schema";
import type {
  BusinessProfile,
  ContentCadence,
  GeneratedPost,
  SocialContentBatch,
} from "@/types/social-content";

/**
 * POST /api/social-content/generate-step
 *
 * QStash callback. Generates one week of social content posts. The
 * route is in PUBLIC_PATH_PATTERNS — security is the QStash signature.
 *
 * Model selection:
 *   - Defaults to anthropic/claude-3.7-sonnet (great quality/cost for
 *     creative content gen, ~10× cheaper than Opus).
 *   - Override per-deployment via SOCIAL_CONTENT_MODEL env var (set to any
 *     OpenRouter model id, e.g. anthropic/claude-sonnet-4.5 once available
 *     on your account).
 */

// Sonnet 4.6 = current best balance of quality + cost for creative
// long-form generation on this account. Verified available 2026-05-25.
const MODEL =
  process.env.SOCIAL_CONTENT_MODEL?.trim() || "anthropic/claude-sonnet-4.6";

export async function POST(request: Request) {
  // 1. Verify QStash signature.
  const signature = request.headers.get("upstash-signature");
  const rawBody = await request.text();
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 401 });
  }
  const valid = await verifyQStashSignature(signature, rawBody);
  if (!valid) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: { batchId?: string; subAccountId?: string; weekIndex?: number };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const { batchId, subAccountId, weekIndex } = body;
  if (!batchId || !subAccountId || typeof weekIndex !== "number") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const db = getAdminDb();
  const batchRef = db.doc(`subAccounts/${subAccountId}/socialContent/${batchId}`);
  const snap = await batchRef.get();
  if (!snap.exists) {
    console.warn(`[social-step] batch ${batchId} not found — skipping`);
    return NextResponse.json({ ok: true, skipped: "not_found" });
  }
  const batch = snap.data() as SocialContentBatch;

  // 2. Idempotency: skip if this week already has posts.
  const alreadyGenerated = (batch.generatedPosts ?? []).some(
    (p) => Math.floor(p.dayOffset / 7) === weekIndex,
  );
  if (alreadyGenerated) {
    console.info(`[social-step] week ${weekIndex} already generated for ${batchId}`);
    return NextResponse.json({ ok: true, skipped: "idempotent" });
  }

  // 3. Flip status to generating on first step.
  if (weekIndex === 0 && batch.status === "queued") {
    await batchRef.update({ status: "generating", updatedAt: Timestamp.now() });
  }

  // 4. Resolve AI provider key + cap.
  let aiCtx;
  try {
    aiCtx = await resolveAiCallContext(subAccountId);
  } catch (err) {
    const reason =
      err instanceof CapExceededError
        ? "cap_exceeded"
        : err instanceof ByokKeyMissingError
          ? "byok_missing"
          : "resolver_error";
    await batchRef.update({
      status: "failed",
      errorMessage: `AI provider check failed: ${reason}`,
      updatedAt: Timestamp.now(),
    });
    console.warn(`[social-step] ${reason} for sa=${subAccountId} batch=${batchId}`);
    return NextResponse.json({ ok: true, failed: reason });
  }

  // 5. Build prompts + call LLM.
  const profile = batch.businessProfile as BusinessProfile;
  const cadence = batch.cadence as ContentCadence;
  const systemPrompt = buildSystemPrompt(profile);
  const weekPrompt = buildWeekPrompt({
    weekIndex,
    platforms: cadence.platforms,
    postsPerWeek: cadence.postsPerWeek,
    totalWeeks: cadence.weeks,
  });

  let completion;
  try {
    completion = await callAi({
      apiKey: aiCtx.apiKey,
      model: MODEL,
      maxTokens: 4000,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: weekPrompt },
      ],
    });
    void aiCtx.recordUsage(completion.totalTokens);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[social-step] LLM call failed batch=${batchId}: ${msg}`);
    await batchRef.update({
      status: "failed",
      errorMessage: `LLM call failed: ${msg.slice(0, 300)}`,
      updatedAt: Timestamp.now(),
    });
    return NextResponse.json({ ok: true, failed: "llm" });
  }

  // 6. Parse + validate output.
  const parsed = parseGeneratedPosts(completion.text);
  if (!parsed) {
    console.error(`[social-step] failed to parse LLM output for ${batchId}`);
    await batchRef.update({
      status: "failed",
      errorMessage: "LLM returned unparseable content (expected JSON array of posts).",
      updatedAt: Timestamp.now(),
    });
    return NextResponse.json({ ok: true, failed: "parse" });
  }

  // 7. Normalize day offsets to fall within this week.
  const baseDay = weekIndex * 7;
  const normalized: GeneratedPost[] = parsed
    .map((p) => {
      const dayInWeek = ((p.dayOffset % 7) + 7) % 7; // safe modulo
      return enforcePlatformLimits({
        ...p,
        dayOffset: baseDay + dayInWeek,
      });
    });

  // 8. Persist the week's posts.
  await batchRef.update({
    generatedPosts: FieldValue.arrayUnion(...normalized),
    "progress.completed": FieldValue.increment(normalized.length),
    tokensUsed: FieldValue.increment(completion.totalTokens),
    modelUsed: completion.model,
    updatedAt: Timestamp.now(),
  });

  // 9. Schedule next week OR mark ready.
  if (weekIndex < cadence.weeks - 1) {
    const published = await publishCallback({
      pathname: "/api/social-content/generate-step",
      body: { batchId, subAccountId, weekIndex: weekIndex + 1 },
      delaySeconds: 2,
      deduplicationId: `socialContent_${batchId}_${weekIndex + 1}`,
    });
    if (!published) {
      console.error(`[social-step] failed to schedule week ${weekIndex + 1} for ${batchId}`);
      await batchRef.update({
        status: "failed",
        errorMessage: "Failed to schedule next week's generation.",
        updatedAt: Timestamp.now(),
      });
    }
  } else {
    await batchRef.update({ status: "ready", updatedAt: Timestamp.now() });
  }

  return NextResponse.json({ ok: true, weekIndex, postsGenerated: normalized.length });
}
