"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { getFirebaseDb } from "@/lib/firebase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format";
import { TradingDisclaimer } from "@/components/trading/trading-disclaimer";
import type { TradingRun } from "@/types/trading";

const STATUS_STYLES: Record<TradingRun["status"], string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  done: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export default function TradingRunDetailPage({
  params,
}: {
  params: Promise<{ subAccountId: string; runId: string }>;
}) {
  const { runId } = use(params);
  const { user, loading: authLoading } = useAuth();
  const { agencyId, subAccountId, saPath } = useSubAccount();
  const [run, setRun] = useState<TradingRun | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !user || !agencyId) return;
    const ref = doc(
      getFirebaseDb(),
      "subAccounts",
      subAccountId,
      "tradingRuns",
      runId,
    );
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setRun(
          snap.exists()
            ? ({ id: snap.id, ...snap.data() } as TradingRun)
            : null,
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [user, agencyId, subAccountId, runId, authLoading]);

  return (
    <div className="space-y-5">
      <Button
        render={<Link href={saPath("/trading")} />}
        variant="ghost"
        size="sm"
        className="-ml-2"
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to Trading OS
      </Button>

      <TradingDisclaimer />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading run…
        </div>
      ) : !run ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Run not found.
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge
                className={`${STATUS_STYLES[run.status]} capitalize`}
                variant="secondary"
              >
                {run.status}
              </Badge>
              <span className="text-xs text-muted-foreground capitalize">
                {run.runType.replace("_", " ")} ·{" "}
                {formatRelativeTime(run.createdAt)} · risk: {run.riskLevel}
              </span>
            </div>
            <h1 className="text-lg font-semibold leading-snug">{run.prompt}</h1>
          </div>

          {run.status === "running" || run.status === "queued" ? (
            <div className="flex items-center gap-2 rounded-xl border bg-card p-5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              The agent is working — results will appear here automatically.
            </div>
          ) : run.status === "failed" ? (
            <div className="rounded-xl border border-red-300/60 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-200">
              {run.error ?? "The run failed."}
            </div>
          ) : (
            <RunResult run={run} />
          )}
        </>
      )}
    </div>
  );
}

function RunResult({ run }: { run: TradingRun }) {
  const result = run.result;
  const metrics = result?.metrics ?? {};
  const equity = result?.equityCurve ?? [];
  const risk = result?.risk ?? {};

  return (
    <div className="space-y-5">
      {Object.keys(metrics).length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(metrics).map(([k, v]) => (
            <div key={k} className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">{k}</p>
              <p className="text-lg font-semibold">{String(v)}</p>
            </div>
          ))}
        </div>
      )}

      {equity.length > 1 && <EquityCurve points={equity} />}

      {Object.keys(risk).length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Risk report</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {Object.entries(risk).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="font-medium">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {run.resultSummaryMd && (
        <div className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Summary</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {run.resultSummaryMd}
          </p>
        </div>
      )}

      {Object.keys(metrics).length === 0 &&
        equity.length <= 1 &&
        !run.resultSummaryMd && (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            The run completed but returned no structured output.
          </div>
        )}
    </div>
  );
}

/** Minimal inline SVG equity curve — no chart library, mirrors reports/. */
function EquityCurve({ points }: { points: { t: string; v: number }[] }) {
  const width = 640;
  const height = 200;
  const pad = 8;
  const values = points.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / (points.length - 1);

  const path = points
    .map((p, i) => {
      const x = pad + i * stepX;
      const y = pad + (height - pad * 2) * (1 - (p.v - min) / range);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="overflow-x-auto rounded-xl border bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold">Equity curve</h2>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-48 w-full min-w-[480px]"
        preserveAspectRatio="none"
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="text-primary"
        />
      </svg>
    </div>
  );
}
