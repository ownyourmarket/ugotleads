import type { Timestamp, FieldValue } from "firebase/firestore";

/**
 * Trading OS module — types.
 *
 * A per-sub-account AI research / strategy / backtesting / risk-analysis
 * workspace powered by an external Vibe Trading service (Python/LangGraph),
 * called over HTTPS the same way the AI Agent talks to OpenRouter/Firecrawl.
 *
 * Data model mirrors the AI Agents shape:
 *   - subAccounts/{id}/tradingAgent/profile        → the risk profile (singleton)
 *   - subAccounts/{id}/tradingRuns/{runId}         → one row per research job
 *   - subAccounts/{id}/brokerConnections/{brokerId}→ per-user self-directed
 *     brokerage link (paper by default; live is user-initiated, never
 *     discretionary — see the compliance note in trading-os-module-spec.md).
 *
 * COMPLIANCE INVARIANT (Phase A): the agent never executes discretionary
 * trades and never takes custody of funds. `mode` may be "research_only" or
 * "paper". "live" is reserved for the self-directed path where the user logs
 * into their OWN broker and pulls the trigger themselves — gated + off by
 * default. The server rejects any run submitted with an execution intent.
 */

/** Risk appetite. Drives the constraints handed to the Vibe swarm. */
export type TradingRiskLevel = "conservative" | "moderate" | "aggressive";

/** Which markets the sub-account is allowed to research. */
export type TradingAssetClass = "stocks" | "crypto" | "forex";

/**
 * Operating mode for the workspace.
 *  - research_only: analysis + backtests, no broker connection at all.
 *  - paper:         paper-trading against a connected broker's sandbox.
 *  - live:          self-directed live trading on the user's OWN account.
 *                   Gated behind `SubAccountDoc.liveTradingEnabledByAgency`
 *                   AND an explicit per-user broker connection. The agent
 *                   still never auto-executes — the user places the trade.
 */
export type TradingMode = "research_only" | "paper" | "live";

/** What a given run asked the Vibe service to do. */
export type TradingRunType =
  | "research"
  | "strategy"
  | "backtest"
  | "risk"
  | "monte_carlo";

/** Lifecycle of a single run. onSnapshot-driven in the UI. */
export type TradingRunStatus = "queued" | "running" | "done" | "failed";

/**
 * Shared risk profile. One per sub-account. Server-only writes.
 * Mirrors AiAgentProfile in spirit — identity/config the runs consume.
 */
export interface TradingProfile {
  riskLevel: TradingRiskLevel;
  allowedAssetClasses: TradingAssetClass[];
  /** Free-text persona / constraints forwarded to the Vibe swarm. */
  strategyPreferences: string;
  /** Names of Vibe data sources to allow (no secrets stored here). */
  dataSourceKeys: string[];
  /** Default backtest window (ISO date strings, YYYY-MM-DD). */
  defaultBacktestStart: string | null;
  defaultBacktestEnd: string | null;
  /** Phase A is locked to research_only | paper. "live" only becomes
   *  selectable once the agency enables it + a broker is connected. */
  mode: TradingMode;
  /** Stamped when the user acknowledges the not-advice disclaimer. Runs
   *  are blocked server-side until this is set. */
  disclaimerAcceptedAt: Timestamp | FieldValue | null;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

export const DEFAULT_TRADING_PROFILE: Omit<
  TradingProfile,
  "createdAt" | "updatedAt" | "disclaimerAcceptedAt"
> = {
  riskLevel: "moderate",
  allowedAssetClasses: ["stocks"],
  strategyPreferences: "",
  dataSourceKeys: [],
  defaultBacktestStart: null,
  defaultBacktestEnd: null,
  mode: "research_only",
};

/** Structured result the Vibe service returns for a terminal run. Loosely
 *  typed — the exact shape varies by runType and is rendered defensively. */
export interface TradingRunResult {
  /** Headline metrics (CAGR, Sharpe, max drawdown, win rate, etc.). */
  metrics?: Record<string, number | string>;
  /** Equity-curve points for the inline SVG chart. */
  equityCurve?: { t: string; v: number }[];
  /** Monte Carlo outcome distribution buckets. */
  monteCarlo?: { p5?: number; p50?: number; p95?: number; samples?: number };
  /** Risk report fields (VaR, exposure, concentration warnings...). */
  risk?: Record<string, number | string>;
  /** Anything else the service returned, preserved verbatim. */
  raw?: Record<string, unknown>;
}

/** One research/backtest job. Server-only writes; members read. */
export interface TradingRun {
  id: string;
  agencyId: string;
  subAccountId: string;
  createdByUid: string;
  /** Natural-language request. */
  prompt: string;
  runType: TradingRunType;
  /** Snapshot of the risk level used, so a later profile edit doesn't
   *  retroactively change what this run was run under. */
  riskLevel: TradingRiskLevel;
  /** External job handle from the Vibe service, used for polling. */
  vibeJobId: string | null;
  status: TradingRunStatus;
  result: TradingRunResult | null;
  /** Human-readable markdown summary (capped). */
  resultSummaryMd: string | null;
  error: string | null;
  /** Poll-loop bookkeeping. */
  pollAttempts: number;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

/** Supported self-directed brokers. Paper sandbox first; live is the same
 *  connection flipped on once the user is comfortable. */
export type BrokerProvider = "alpaca" | "manual";

export type BrokerConnectionMode = "paper" | "live";

/**
 * A user's self-directed broker link. The KEY point for compliance: this
 * connects the USER's own account. The platform never holds withdrawal
 * rights and never places discretionary trades — it surfaces the research;
 * the user executes. Credentials are NOT stored in Firestore; only the
 * connection status + non-secret metadata live here (the secret is held by
 * the Vibe service / a vault keyed by connectionId).
 */
export interface BrokerConnection {
  id: string;
  agencyId: string;
  subAccountId: string;
  createdByUid: string;
  provider: BrokerProvider;
  mode: BrokerConnectionMode;
  /** Display-only account label (e.g. masked account number). */
  accountLabel: string | null;
  connected: boolean;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}
