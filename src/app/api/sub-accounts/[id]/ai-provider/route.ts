import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  readAiUsageSnapshot,
  DEFAULT_CAP,
  TIER_CAPS,
} from "@/lib/comms/ai/provider-resolver";
import { callAi } from "@/lib/comms/ai/openrouter";
import type { AiProviderMode } from "@/types/tenancy";

/**
 * GET /api/sub-accounts/[id]/ai-provider
 *
 * Returns the current AI provider config + usage snapshot for the UI.
 * Never returns the BYOK key itself — only `byokKeyLast4` for display.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  try {
    const snapshot = await readAiUsageSnapshot(id);
    return NextResponse.json({
      mode: snapshot.mode,
      byokKeyLast4: snapshot.byokKeyLast4,
      usage: {
        currentPeriodTokens: snapshot.currentPeriodTokens,
        monthlyCapTokens: snapshot.monthlyCapTokens,
        lifetimeTokens: snapshot.lifetimeTokens,
        currentPeriodStart: snapshot.currentPeriodStart.toISOString(),
        resetsAt: snapshot.resetsAt.toISOString(),
      },
      tierCaps: TIER_CAPS,
      defaultCap: DEFAULT_CAP,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * PATCH /api/sub-accounts/[id]/ai-provider
 *
 * Body shapes:
 *   { mode: "hosted" }                     — switch to hosted (default tier cap)
 *   { mode: "byok", byokKey: "sk-or-..." } — switch to BYOK + set key
 *   { byokKey: null }                      — clear BYOK key + fall back to hosted
 *
 * The BYOK key, when provided, is optionally validated against OpenRouter
 * via a 1-token test call before being persisted (set `validate: true`).
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  let body: {
    mode?: AiProviderMode;
    byokKey?: string | null;
    validate?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const requestedMode = body.mode;
  const newKey = typeof body.byokKey === "string" ? body.byokKey.trim() : body.byokKey;

  if (requestedMode && requestedMode !== "hosted" && requestedMode !== "byok") {
    return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
  }

  // Resolve target state.
  const targetMode: AiProviderMode =
    requestedMode ?? (newKey ? "byok" : "hosted");

  // Validate BYOK key if requested (cheap test call).
  if (targetMode === "byok") {
    if (!newKey) {
      return NextResponse.json(
        { error: "byok_key_required" },
        { status: 400 },
      );
    }
    if (!newKey.startsWith("sk-or-")) {
      return NextResponse.json(
        {
          error: "invalid_byok_key",
          message: "OpenRouter keys start with `sk-or-`. Get one at openrouter.ai/keys.",
        },
        { status: 400 },
      );
    }
    if (body.validate) {
      try {
        await callAi({
          apiKey: newKey,
          messages: [{ role: "user", content: "ping" }],
          maxTokens: 5,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json(
          {
            error: "byok_validation_failed",
            message: `OpenRouter rejected the key: ${msg.slice(0, 200)}`,
          },
          { status: 400 },
        );
      }
    }
  }

  const db = getAdminDb();
  const ref = db.doc(`subAccounts/${id}`);

  const updatePayload: Record<string, unknown> = {
    aiProvider: {
      mode: targetMode,
      byokKey: targetMode === "byok" ? newKey : null,
      byokKeyLast4: targetMode === "byok" && newKey ? newKey.slice(-4) : null,
      byokKeyValidatedAt: targetMode === "byok" && body.validate ? Timestamp.now() : null,
    },
  };

  // Lazy-init aiUsage block if missing.
  const existing = (await ref.get()).data();
  if (!existing?.aiUsage) {
    updatePayload.aiUsage = {
      currentPeriodTokens: 0,
      currentPeriodStart: Timestamp.now(),
      monthlyCapTokens: DEFAULT_CAP,
      lifetimeTokens: 0,
      lastWarningAt: null,
    };
  }

  await ref.set(updatePayload, { merge: true });

  return NextResponse.json({
    ok: true,
    mode: targetMode,
    byokKeyLast4: targetMode === "byok" && newKey ? newKey.slice(-4) : null,
  });
}

/**
 * DELETE /api/sub-accounts/[id]/ai-provider
 *
 * Convenience: reset to hosted mode + clear any BYOK key.
 */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  const db = getAdminDb();
  await db.doc(`subAccounts/${id}`).set(
    {
      aiProvider: {
        mode: "hosted",
        byokKey: null,
        byokKeyLast4: null,
        byokKeyValidatedAt: null,
      },
    },
    { merge: true },
  );

  return NextResponse.json({ ok: true, mode: "hosted" });
}
