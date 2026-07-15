"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { toast } from "sonner";
import { Loader2, LineChart, Play, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { getFirebaseDb } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime, toDate } from "@/lib/format";
import { TradingDisclaimer } from "@/components/trading/trading-disclaimer";
import { BrokerSection } from "@/components/trading/broker-section";
import type {
  TradingProfile,
  TradingRun,
  TradingRunType,
  TradingRiskLevel,
  TradingAssetClass,
} from "@/types/trading";

const RISK_LEVELS: TradingRiskLevel[] = [
  "conservative",
  "moderate",
  "aggressive",
];
const ASSET_CLASSES: TradingAssetClass[] = ["stocks", "crypto", "forex"];
const RUN_TYPES: { value: TradingRunType; label: string }[] = [
  { value: "research", label: "Research" },
  { value: "strategy", label: "Strategy" },
  { value: "backtest", label: "Backtest" },
  { value: "risk", label: "Risk analysis" },
  { value: "monte_carlo", label: "Monte Carlo" },
];

const STATUS_STYLES: Record<TradingRun["status"], string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  done: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export default function TradingOverviewPage() {
  const { user, loading: authLoading } = useAuth();
  const { agencyId, subAccountId, saPath, isAdmin } = useSubAccount();

  const [profile, setProfile] = useState<TradingProfile | null>(null);
  const [runs, setRuns] = useState<TradingRun[]>([]);
  const [loading, setLoading] = useState(true);

  // Profile subscription.
  useEffect(() => {
    if (authLoading || !user || !agencyId) return;
    const ref = doc(
      getFirebaseDb(),
      "subAccounts",
      subAccountId,
      "tradingAgent",
      "profile",
    );
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setProfile(snap.exists() ? (snap.data() as TradingProfile) : null);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [user, agencyId, subAccountId, authLoading]);

  // Runs subscription.
  useEffect(() => {
    if (authLoading || !user || !agencyId) return;
    const q = query(
      collection(getFirebaseDb(), "subAccounts", subAccountId, "tradingRuns"),
      where("subAccountId", "==", subAccountId),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as TradingRun,
      );
      list.sort(
        (a, b) =>
          (toDate(b.createdAt)?.getTime() ?? 0) -
          (toDate(a.createdAt)?.getTime() ?? 0),
      );
      setRuns(list);
    });
    return () => unsub();
  }, [user, agencyId, subAccountId, authLoading]);

  const disclaimerAccepted = !!profile?.disclaimerAcceptedAt;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Trading OS</h1>
        <p className="text-sm text-muted-foreground">
          AI research, strategy generation, backtesting, and risk analysis.
        </p>
      </div>

      <TradingDisclaimer />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : !profile || !disclaimerAccepted ? (
        <ProfileSetup
          subAccountId={subAccountId}
          profile={profile}
          isAdmin={isAdmin}
        />
      ) : (
        <>
          <RunComposer subAccountId={subAccountId} />
          <ProfileSummary
            subAccountId={subAccountId}
            profile={profile}
            isAdmin={isAdmin}
          />
          <BrokerSection subAccountId={subAccountId} />
          <RunList runs={runs} saPath={saPath} />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Profile setup / acceptance gate

function ProfileSetup({
  subAccountId,
  profile,
  isAdmin,
}: {
  subAccountId: string;
  profile: TradingProfile | null;
  isAdmin: boolean;
}) {
  const [riskLevel, setRiskLevel] = useState<TradingRiskLevel>(
    profile?.riskLevel ?? "moderate",
  );
  const [assets, setAssets] = useState<TradingAssetClass[]>(
    profile?.allowedAssetClasses ?? ["stocks"],
  );
  const [prefs, setPrefs] = useState(profile?.strategyPreferences ?? "");
  const [saving, setSaving] = useState(false);

  function toggleAsset(a: TradingAssetClass) {
    setAssets((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a],
    );
  }

  async function save() {
    if (!isAdmin) {
      toast.error("Only sub-account admins can set the risk profile.");
      return;
    }
    if (assets.length === 0) {
      toast.error("Pick at least one asset class.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/trading/profile`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            riskLevel,
            allowedAssetClasses: assets,
            strategyPreferences: prefs,
            acceptDisclaimer: true,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't save the profile.");
        return;
      }
      toast.success("Trading profile saved. You're ready to run research.");
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h2 className="font-semibold">Set up your trading research profile</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Your risk level and preferences shape the research the agent produces.
        Nothing here trades money — it runs analysis and backtests you review.
      </p>

      <div className="space-y-2">
        <Label>Risk level</Label>
        <div className="flex flex-wrap gap-2">
          {RISK_LEVELS.map((r) => (
            <Button
              key={r}
              type="button"
              variant={riskLevel === r ? "default" : "outline"}
              size="sm"
              onClick={() => setRiskLevel(r)}
            >
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Asset classes</Label>
        <div className="flex flex-wrap gap-2">
          {ASSET_CLASSES.map((a) => (
            <Button
              key={a}
              type="button"
              variant={assets.includes(a) ? "default" : "outline"}
              size="sm"
              onClick={() => toggleAsset(a)}
            >
              {a.charAt(0).toUpperCase() + a.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="prefs">Strategy preferences (optional)</Label>
        <Textarea
          id="prefs"
          value={prefs}
          onChange={(e) => setPrefs(e.target.value)}
          placeholder="e.g. prefer trend-following, avoid leverage, focus on large-cap US equities…"
          rows={3}
        />
      </div>

      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        By continuing you acknowledge this is a research and educational tool,
        not investment advice, and that you make your own trading decisions.
      </div>

      <Button onClick={save} disabled={saving || !isAdmin}>
        {saving ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <ShieldCheck className="mr-1 h-4 w-4" />
        )}
        I understand — save profile
      </Button>
      {!isAdmin && (
        <p className="text-xs text-muted-foreground">
          Ask a sub-account admin to complete this setup.
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Run composer

function RunComposer({ subAccountId }: { subAccountId: string }) {
  const [prompt, setPrompt] = useState("");
  const [runType, setRunType] = useState<TradingRunType>("research");
  const [submitting, setSubmitting] = useState(false);

  async function run() {
    const trimmed = prompt.trim();
    if (trimmed.length < 3) {
      toast.error("Describe what you want the agent to research.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/trading/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: trimmed, runType }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't start the run.");
        return;
      }
      toast.success("Run started — results will stream in below.");
      setPrompt("");
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <LineChart className="h-5 w-5 text-primary" />
        <h2 className="font-semibold">New research run</h2>
      </div>
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. Backtest a 50/200-day moving-average crossover on SPY over the last 10 years and report Sharpe + max drawdown."
        rows={3}
      />
      <div className="flex flex-wrap items-center gap-2">
        {RUN_TYPES.map((t) => (
          <Button
            key={t.value}
            type="button"
            variant={runType === t.value ? "default" : "outline"}
            size="sm"
            onClick={() => setRunType(t.value)}
          >
            {t.label}
          </Button>
        ))}
        <div className="ml-auto">
          <Button onClick={run} disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-1 h-4 w-4" />
            )}
            Run
          </Button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Profile summary (compact, when already set up)

function ProfileSummary({
  subAccountId,
  profile,
  isAdmin,
}: {
  subAccountId: string;
  profile: TradingProfile;
  isAdmin: boolean;
}) {
  const [saving, setSaving] = useState(false);

  async function setRisk(riskLevel: TradingRiskLevel) {
    if (!isAdmin) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/trading/profile`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ riskLevel }),
        },
      );
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Couldn't update risk level.");
      }
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-sm">
      <span className="text-muted-foreground">Risk level:</span>
      {RISK_LEVELS.map((r) => (
        <Button
          key={r}
          type="button"
          size="sm"
          variant={profile.riskLevel === r ? "default" : "outline"}
          disabled={!isAdmin || saving}
          onClick={() => setRisk(r)}
        >
          {r.charAt(0).toUpperCase() + r.slice(1)}
        </Button>
      ))}
      <span className="ml-2 text-muted-foreground">
        Assets: {profile.allowedAssetClasses.join(", ") || "—"}
      </span>
      <Badge variant="outline" className="ml-auto capitalize">
        {profile.mode.replace("_", " ")}
      </Badge>
    </div>
  );
}

// ------------------------------------------------------------
// Run list

function RunList({
  runs,
  saPath,
}: {
  runs: TradingRun[];
  saPath: (p: string) => string;
}) {
  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        No runs yet. Describe a strategy or research question above to start.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground">
        Run history
      </h2>
      {runs.map((r) => (
        <Link
          key={r.id}
          href={saPath(`/trading/runs/${r.id}`)}
          className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent"
        >
          <Badge
            className={`${STATUS_STYLES[r.status]} shrink-0 capitalize`}
            variant="secondary"
          >
            {r.status}
          </Badge>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{r.prompt}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {r.runType.replace("_", " ")} ·{" "}
              {formatRelativeTime(r.createdAt) ?? "just now"}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
