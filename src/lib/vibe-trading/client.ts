import "server-only";

import type {
  TradingRiskLevel,
  TradingAssetClass,
  TradingRunType,
  TradingRunResult,
} from "@/types/trading";

/**
 * Vibe Trading service client — agency-level integration.
 *
 * The Vibe Trading engine (HKUDS/Vibe-Trading, Python/LangGraph) runs as a
 * separate self-hosted service (Railway — same box family as our n8n +
 * agentic-workflow services). uGotLeads never runs the Python; it calls the
 * service's HTTP API with an agency-level key, exactly how lib/firecrawl and
 * lib/gitpage wrap their upstreams.
 *
 * Env:
 *   VIBE_TRADING_API_URL  — base URL of the deployed service
 *   VIBE_TRADING_API_KEY  — Bearer key (agency-level, shared across sub-accounts)
 *
 * If unset, vibeTradingIsConfigured() is false and callers return 503 with a
 * friendly message — the rest of the CRM is unaffected.
 *
 * v1 uses two endpoints:
 *   submitRun → POST /v1/runs        (202 + jobId)
 *   pollRun   → GET  /v1/runs/:jobId (status + result once terminal)
 *
 * COMPLIANCE: this client only ever requests research / paper work. It never
 * sends an execution instruction — discretionary trading is out of Phase A.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

function getBaseUrl(): string | null {
  const raw = process.env.VIBE_TRADING_API_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : null;
}

function getApiKey(): string | null {
  return process.env.VIBE_TRADING_API_KEY?.trim() || null;
}

export function vibeTradingIsConfigured(): boolean {
  return !!getBaseUrl() && !!getApiKey();
}

export class VibeTradingError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "VibeTradingError";
    this.status = status;
  }
}

function requireConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = getBaseUrl();
  const apiKey = getApiKey();
  if (!baseUrl || !apiKey) {
    throw new VibeTradingError(
      "Vibe Trading is not configured (VIBE_TRADING_API_URL / VIBE_TRADING_API_KEY missing).",
      503,
    );
  }
  return { baseUrl, apiKey };
}

export interface SubmitRunInput {
  subAccountId: string;
  runType: TradingRunType;
  prompt: string;
  riskLevel: TradingRiskLevel;
  allowedAssetClasses: TradingAssetClass[];
  strategyPreferences: string;
  dataSourceKeys: string[];
  /** paper | research_only only in Phase A — enforced by the caller. */
  mode: "research_only" | "paper";
  backtestStart?: string | null;
  backtestEnd?: string | null;
}

export interface SubmitRunResult {
  jobId: string;
  /** Suggested seconds between polls; caller may clamp. */
  pollIntervalSeconds: number;
}

/**
 * Kick off a run. Returns the job handle for polling. Throws
 * VibeTradingError on any non-2xx so the route can map it to a friendly
 * status for the operator.
 */
export async function submitRun(
  input: SubmitRunInput,
): Promise<SubmitRunResult> {
  const { baseUrl, apiKey } = requireConfig();

  const res = await fetch(`${baseUrl}/v1/runs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subAccountId: input.subAccountId,
      runType: input.runType,
      prompt: input.prompt,
      riskLevel: input.riskLevel,
      assetClasses: input.allowedAssetClasses,
      strategyPreferences: input.strategyPreferences,
      dataSources: input.dataSourceKeys,
      mode: input.mode,
      ...(input.backtestStart ? { backtestStart: input.backtestStart } : {}),
      ...(input.backtestEnd ? { backtestEnd: input.backtestEnd } : {}),
    }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  const body = await safeJson(res);
  if (!res.ok) {
    throw new VibeTradingError(
      `Vibe Trading returned ${res.status}: ${extractError(body)}`,
      res.status,
    );
  }
  if (typeof body.jobId !== "string") {
    throw new VibeTradingError(
      "Vibe Trading accepted the run but returned no jobId.",
      502,
    );
  }
  return {
    jobId: body.jobId,
    pollIntervalSeconds:
      typeof body.pollIntervalSeconds === "number"
        ? body.pollIntervalSeconds
        : 15,
  };
}

export interface PollRunResult {
  status: "queued" | "running" | "done" | "failed";
  result: TradingRunResult | null;
  resultSummaryMd: string | null;
  error: string | null;
  isTerminal: boolean;
}

/** Poll a run's status. Throws VibeTradingError on transport failure. */
export async function pollRun(jobId: string): Promise<PollRunResult> {
  const { baseUrl, apiKey } = requireConfig();

  const res = await fetch(
    `${baseUrl}/v1/runs/${encodeURIComponent(jobId)}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    },
  );

  const body = await safeJson(res);
  if (!res.ok) {
    throw new VibeTradingError(
      `Vibe Trading poll returned ${res.status}: ${extractError(body)}`,
      res.status,
    );
  }

  const rawStatus = typeof body.status === "string" ? body.status : "running";
  const status: PollRunResult["status"] =
    rawStatus === "done" || rawStatus === "completed"
      ? "done"
      : rawStatus === "failed" || rawStatus === "error"
        ? "failed"
        : rawStatus === "queued"
          ? "queued"
          : "running";

  return {
    status,
    result: (body.result as TradingRunResult) ?? null,
    resultSummaryMd:
      typeof body.summaryMarkdown === "string"
        ? body.summaryMarkdown.slice(0, 20_000)
        : null,
    error: typeof body.error === "string" ? body.error : null,
    isTerminal: status === "done" || status === "failed",
  };
}

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractError(body: Record<string, unknown>): string {
  if (typeof body.error === "string") return body.error;
  if (typeof body.message === "string") return body.message;
  return "unknown error";
}
