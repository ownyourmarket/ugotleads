import "server-only";

import { NextResponse } from "next/server";
import {
  publishCallback,
  qstashIsConfigured,
  verifyQStashSignature,
} from "@/lib/automations/qstash";
import { pollRun, VibeTradingError } from "@/lib/vibe-trading/client";
import {
  getTradingRun,
  updateTradingRun,
  settleTradingRun,
} from "@/lib/trading/store";

export const dynamic = "force-dynamic";

/**
 * QStash callback that polls the Vibe service for a run's status. Mirrors the
 * gitpage website poll loop:
 *   1. Verify the Upstash-Signature header.
 *   2. Load the run; bail if it's already terminal or the job id drifted.
 *   3. Poll the Vibe service.
 *   4. Mirror the result into Firestore.
 *   5. If still running and under the cap, reschedule +interval.
 *
 * Route is in PUBLIC_PATH_PATTERNS — security is the signature, not a cookie.
 */

const POLL_INTERVAL_SECONDS = 15;
// ~15 min ceiling at 15s cadence.
const MAX_POLL_ATTEMPTS = 60;

interface PollPayload {
  subAccountId?: string;
  runId?: string;
  jobId?: string;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: subAccountId } = await ctx.params;

  if (!qstashIsConfigured()) {
    return NextResponse.json(
      { error: "QStash is not configured." },
      { status: 503 },
    );
  }

  const signature = request.headers.get("upstash-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing Upstash-Signature header" },
      { status: 401 },
    );
  }

  const rawBody = await request.text();
  const valid = await verifyQStashSignature(signature, rawBody);
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: PollPayload;
  try {
    payload = JSON.parse(rawBody) as PollPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    payload.subAccountId !== subAccountId ||
    typeof payload.runId !== "string" ||
    typeof payload.jobId !== "string"
  ) {
    return NextResponse.json(
      { error: "Body must include subAccountId + runId + jobId" },
      { status: 400 },
    );
  }

  const run = await getTradingRun(subAccountId, payload.runId);
  if (!run) {
    return NextResponse.json({ ok: true, ignored: "run-missing" });
  }
  // Stale tick: run already settled or job id drifted (re-submitted).
  if (
    run.vibeJobId !== payload.jobId ||
    (run.status !== "queued" && run.status !== "running")
  ) {
    return NextResponse.json({ ok: true, ignored: "stale-tick" });
  }

  const attempts = (run.pollAttempts ?? 0) + 1;
  if (attempts > MAX_POLL_ATTEMPTS) {
    await settleTradingRun(subAccountId, payload.runId, "failed", {
      error:
        "Run is taking longer than expected (15+ min). The engine may still finish — re-open later.",
    });
    return NextResponse.json({ ok: true, settled: "timeout" });
  }

  let poll;
  try {
    poll = await pollRun(payload.jobId);
  } catch (err) {
    // Transient transport error — bump attempts + reschedule rather than
    // failing the run on a single hiccup.
    const message =
      err instanceof VibeTradingError ? err.message : "poll transport error";
    await updateTradingRun(subAccountId, payload.runId, {
      pollAttempts: attempts,
    });
    await reschedule(subAccountId, payload.runId, payload.jobId, attempts);
    return NextResponse.json({ ok: true, retrying: message });
  }

  if (poll.isTerminal) {
    await settleTradingRun(
      subAccountId,
      payload.runId,
      poll.status === "done" ? "done" : "failed",
      {
        result: poll.result,
        resultSummaryMd: poll.resultSummaryMd,
        error: poll.error,
      },
    );
    return NextResponse.json({ ok: true, settled: poll.status });
  }

  // Still running — persist attempts + reschedule.
  await updateTradingRun(subAccountId, payload.runId, {
    status: "running",
    pollAttempts: attempts,
  });
  await reschedule(subAccountId, payload.runId, payload.jobId, attempts);
  return NextResponse.json({ ok: true, status: "running", attempts });
}

async function reschedule(
  subAccountId: string,
  runId: string,
  jobId: string,
  attempts: number,
): Promise<void> {
  await publishCallback({
    pathname: `/api/sub-accounts/${subAccountId}/trading/poll`,
    body: { subAccountId, runId, jobId },
    delaySeconds: POLL_INTERVAL_SECONDS,
    deduplicationId: `trading_poll_${runId}_${attempts}`,
  });
}
