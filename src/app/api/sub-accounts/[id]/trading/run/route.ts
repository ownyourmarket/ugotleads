import { NextResponse } from "next/server";
import { requireSubAccountMember } from "@/lib/auth/require-tenancy";
import {
  vibeTradingIsConfigured,
  submitRun,
  VibeTradingError,
} from "@/lib/vibe-trading/client";
import {
  getTradingProfile,
  createTradingRun,
  updateTradingRun,
} from "@/lib/trading/store";
import { publishCallback, qstashIsConfigured } from "@/lib/automations/qstash";
import type { TradingRunType } from "@/types/trading";

export const dynamic = "force-dynamic";

const RUN_TYPES: TradingRunType[] = [
  "research",
  "strategy",
  "backtest",
  "risk",
  "monte_carlo",
];

const POLL_INTERVAL_SECONDS = 15;

/**
 * Submit a Trading OS research/backtest run. Any active member can run
 * research (it never touches money). Pre-flight:
 *   - Vibe service configured
 *   - a profile exists AND the not-advice disclaimer was accepted
 *   - mode is research_only | paper (never live from this path)
 * Creates the run row, submits to Vibe, then schedules a QStash poll.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: subAccountId } = await ctx.params;
  const access = await requireSubAccountMember(request, subAccountId);
  if (access instanceof NextResponse) return access;

  if (!vibeTradingIsConfigured()) {
    return NextResponse.json(
      {
        error:
          "Trading engine is not configured on this deployment (VIBE_TRADING_API_URL / VIBE_TRADING_API_KEY missing).",
      },
      { status: 503 },
    );
  }

  let body: { prompt?: unknown; runType?: unknown };
  try {
    body = (await request.json()) as { prompt?: unknown; runType?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const prompt =
    typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < 3 || prompt.length > 4000) {
    return NextResponse.json(
      { error: "prompt must be 3–4000 characters." },
      { status: 400 },
    );
  }
  const runType: TradingRunType =
    typeof body.runType === "string" &&
    RUN_TYPES.includes(body.runType as TradingRunType)
      ? (body.runType as TradingRunType)
      : "research";

  const profile = await getTradingProfile(subAccountId);
  if (!profile) {
    return NextResponse.json(
      { error: "Set up the trading risk profile first." },
      { status: 409 },
    );
  }
  if (!profile.disclaimerAcceptedAt) {
    return NextResponse.json(
      {
        error:
          "The research disclaimer must be acknowledged before running the agent.",
      },
      { status: 409 },
    );
  }
  // Defense in depth: never let a "live" profile drive a run from here.
  const mode = profile.mode === "paper" ? "paper" : "research_only";

  const agencyId = access.agencyId;
  if (!agencyId) {
    return NextResponse.json(
      { error: "Caller has no agency context." },
      { status: 403 },
    );
  }

  const runId = await createTradingRun({
    agencyId,
    subAccountId,
    createdByUid: access.uid,
    prompt,
    runType,
    riskLevel: profile.riskLevel,
  });

  // Submit to the Vibe service. On failure, mark the run failed and surface.
  try {
    const submission = await submitRun({
      subAccountId,
      runType,
      prompt,
      riskLevel: profile.riskLevel,
      allowedAssetClasses: profile.allowedAssetClasses,
      strategyPreferences: profile.strategyPreferences,
      dataSourceKeys: profile.dataSourceKeys,
      mode,
      backtestStart: profile.defaultBacktestStart,
      backtestEnd: profile.defaultBacktestEnd,
    });

    await updateTradingRun(subAccountId, runId, {
      vibeJobId: submission.jobId,
      status: "running",
    });

    // Schedule the first poll. If QStash isn't configured, the run still
    // exists at status "running"; it just won't auto-settle until the
    // operator re-triggers (documented limitation, mirrors gitpage).
    if (qstashIsConfigured()) {
      await publishCallback({
        pathname: `/api/sub-accounts/${subAccountId}/trading/poll`,
        body: { subAccountId, runId, jobId: submission.jobId },
        delaySeconds: submission.pollIntervalSeconds || POLL_INTERVAL_SECONDS,
        deduplicationId: `trading_poll_${runId}_0`,
      });
    }

    return NextResponse.json({ runId, status: "running" });
  } catch (err) {
    const message =
      err instanceof VibeTradingError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not reach the trading engine.";
    const status = err instanceof VibeTradingError ? err.status : 502;
    await updateTradingRun(subAccountId, runId, {
      status: "failed",
      error: message,
    });
    return NextResponse.json({ error: message, runId }, { status });
  }
}
