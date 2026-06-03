"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Award,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clock,
  DollarSign,
  Info,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { subscribeToAgencyPurchases } from "@/lib/firestore/marketplace-purchases";
import {
  subscribeToAgencyCommissionEvents,
} from "@/lib/firestore/commission";
import { subscribeToPartnerProfiles } from "@/lib/firestore/partners";
import type { MarketplacePurchase } from "@/types/marketplace";
import type { CommissionEvent } from "@/types/credits";
import type { PartnerProfile } from "@/types/partner";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Readiness payload (from GET /api/agency/readiness)
// ---------------------------------------------------------------------------

type ReadinessSeverity = "ok" | "warn" | "blocked" | "info";

interface ReadinessItem {
  key: string;
  label: string;
  severity: ReadinessSeverity;
  detail: string;
}

interface ReadinessResponse {
  ok: boolean;
  env: { isProd: boolean };
  summary: { blockers: number; warnings: number; total: number };
  checklist: ReadinessItem[];
}

const READINESS_DOT: Record<ReadinessSeverity, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  blocked: "bg-red-500",
  info: "bg-sky-400",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function fmtDate(value: unknown): string {
  if (!value) return "—";
  const ts = value as { toDate?: () => Date };
  const d = typeof ts.toDate === "function" ? ts.toDate() : (value as Date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof DollarSign;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <div className="rounded-lg bg-muted p-1.5">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
      <p className={cn("text-2xl font-bold tabular-nums", accent ?? "text-foreground")}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, count }: { icon: typeof DollarSign; title: string; count?: number }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {count !== undefined && (
        <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
          {count}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgencyRevenueCockpitPage() {
  const { agencyId, agencyRole } = useAuth();
  const isOwner = agencyRole === "owner";

  const [purchases, setPurchases] = useState<MarketplacePurchase[]>([]);
  const [commissionEvents, setCommissionEvents] = useState<CommissionEvent[]>([]);
  const [partners, setPartners] = useState<PartnerProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Production readiness snapshot (server-computed) ──────────────────────
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [showReadiness, setShowReadiness] = useState(false);

  useEffect(() => {
    if (!agencyId || !isOwner) { setLoading(false); return; }

    let doneCount = 0;
    const check = () => { if (++doneCount === 3) setLoading(false); };

    const u1 = subscribeToAgencyPurchases(agencyId, (d) => { setPurchases(d); check(); }, () => check());
    const u2 = subscribeToAgencyCommissionEvents(agencyId, (d) => { setCommissionEvents(d); check(); }, () => check());
    const u3 = subscribeToPartnerProfiles(agencyId, (d) => { setPartners(d); check(); }, () => check());

    return () => { u1(); u2(); u3(); };
  }, [agencyId, isOwner]);

  useEffect(() => {
    if (!isOwner) return;
    fetch("/api/agency/readiness", { credentials: "include" })
      .then((r) => r.json())
      .then((data: ReadinessResponse & { error?: string }) => {
        if (data.ok) setReadiness(data);
      })
      .catch(() => { /* readiness is best-effort */ });
  }, [isOwner]);

  // ── Derived: purchases ─────────────────────────────────────────────────
  const paidPurchases = useMemo(
    () => purchases.filter((p) => p.paymentStatus === "paid"),
    [purchases],
  );
  const totalRevenueCents = useMemo(
    () => paidPurchases.reduce((s, p) => s + p.amountTotalCents, 0),
    [paidPurchases],
  );
  const attributedCount = useMemo(
    () => paidPurchases.filter((p) => !!p.referredByPartnerProfileId).length,
    [paidPurchases],
  );
  const attributedPct = paidPurchases.length > 0
    ? Math.round((attributedCount / paidPurchases.length) * 100)
    : 0;

  // ── Derived: products ─────────────────────────────────────────────────
  const productRows = useMemo(() => {
    const map = new Map<string, { name: string; family: string | null; count: number; revCents: number }>();
    for (const p of paidPurchases) {
      const existing = map.get(p.productId);
      if (existing) {
        existing.count++;
        existing.revCents += p.amountTotalCents;
      } else {
        map.set(p.productId, {
          name: p.productName,
          family: p.productFamily,
          count: 1,
          revCents: p.amountTotalCents,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.revCents - a.revCents);
  }, [paidPurchases]);

  // ── Derived: top partners by attributed revenue ────────────────────────
  const topPartners = useMemo(() => {
    const map = new Map<string, { name: string; count: number; revCents: number }>();
    const profileMap = new Map(partners.map((p) => [p.id, p]));
    for (const p of paidPurchases) {
      if (!p.referredByPartnerProfileId) continue;
      const pid = p.referredByPartnerProfileId;
      const profile = profileMap.get(pid);
      const name = profile?.displayName ?? profile?.fullName ?? pid;
      const existing = map.get(pid);
      if (existing) {
        existing.count++;
        existing.revCents += p.amountTotalCents;
      } else {
        map.set(pid, { name, count: 1, revCents: p.amountTotalCents });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.revCents - a.revCents).slice(0, 8);
  }, [paidPurchases, partners]);

  // ── Derived: commissions ──────────────────────────────────────────────
  const pendingCommCents = useMemo(
    () => commissionEvents.filter((e) => e.status === "pending").reduce((s, e) => s + e.commissionCents, 0),
    [commissionEvents],
  );
  const paidCommCents = useMemo(
    () => commissionEvents.filter((e) => e.status === "paid").reduce((s, e) => s + e.commissionCents, 0),
    [commissionEvents],
  );

  // ── Derived: partners by status ───────────────────────────────────────
  const activePartners = useMemo(
    () => partners.filter((p) => p.status === "active" || p.status === "approved").length,
    [partners],
  );

  // Recent feeds (newest first, already ordered by subscription)
  const recentPurchases = purchases.slice(0, 8);
  const recentCommissions = commissionEvents.slice(0, 8);

  // ── Access guard ──────────────────────────────────────────────────────
  if (!isOwner) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <TrendingUp className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground">Agency owner access required.</p>
        <Link href="/agency" className="text-xs text-primary underline underline-offset-2">Back to agency</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-8 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            <span className="text-sm font-medium uppercase tracking-wider">Revenue OS</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Agency Cockpit</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time overview of marketplace revenue, partners, and commissions.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/agency/marketplace-purchases"
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            All purchases
          </Link>
          <Link
            href="/agency/commissions"
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <DollarSign className="h-3.5 w-3.5" />
            Commissions
          </Link>
        </div>
      </div>

      {/* ── Production readiness checklist ── */}
      {readiness && (
        <div className="rounded-xl border bg-card">
          <button
            type="button"
            onClick={() => setShowReadiness((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Production readiness</h2>
              {readiness.summary.blockers > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  {readiness.summary.blockers} blocker{readiness.summary.blockers !== 1 ? "s" : ""}
                </span>
              )}
              {readiness.summary.blockers === 0 && readiness.summary.warnings > 0 && (
                <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  {readiness.summary.warnings} warning{readiness.summary.warnings !== 1 ? "s" : ""}
                </span>
              )}
              {readiness.summary.blockers === 0 && readiness.summary.warnings === 0 && (
                <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  All clear
                </span>
              )}
            </div>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showReadiness && "rotate-180")} />
          </button>
          {showReadiness && (
            <div className="border-t px-5 py-4">
              <ul className="space-y-2.5">
                {readiness.checklist.map((item) => (
                  <li key={item.key} className="flex items-start gap-2.5">
                    <span className={cn("mt-1.5 h-2 w-2 flex-shrink-0 rounded-full", READINESS_DOT[item.severity])} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">
                        {item.label}
                        {item.severity === "blocked" && (
                          <span className="ml-2 text-[10px] font-semibold uppercase text-red-600 dark:text-red-400">Blocker</span>
                        )}
                        {item.severity === "info" && (
                          <Info className="ml-1 inline h-3 w-3 text-sky-400" />
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{item.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-muted-foreground/70">
                Point-in-time snapshot. Refresh the page to re-run checks. Secrets are reported as
                set/unset only — never displayed.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      )}

      {!loading && (
        <>
          {/* ── Summary stat cards ── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Revenue collected"
              value={fmtUsd(totalRevenueCents)}
              sub={`${paidPurchases.length} paid purchase${paidPurchases.length !== 1 ? "s" : ""}`}
              icon={DollarSign}
            />
            <StatCard
              label="Active partners"
              value={String(activePartners)}
              sub={`${partners.length} total enrolled`}
              icon={Users}
            />
            <StatCard
              label="Pending commissions"
              value={fmtUsd(pendingCommCents)}
              sub={`${commissionEvents.filter((e) => e.status === "pending").length} events`}
              icon={Clock}
              accent="text-amber-600 dark:text-amber-400"
            />
            <StatCard
              label="Lifetime paid out"
              value={fmtUsd(paidCommCents)}
              sub={`${commissionEvents.filter((e) => e.status === "paid").length} events`}
              icon={CheckCircle2}
              accent="text-emerald-600 dark:text-emerald-400"
            />
          </div>

          {/* ── Middle row: Product performance + Attribution ── */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Product performance */}
            <section className="rounded-xl border bg-card p-5">
              <SectionHeader icon={BarChart3} title="Product Performance" count={productRows.length} />
              {productRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No paid purchases yet.</p>
              ) : (
                <div className="space-y-2">
                  {/* Revenue bar chart */}
                  {productRows.map((row) => {
                    const pct = totalRevenueCents > 0
                      ? Math.round((row.revCents / totalRevenueCents) * 100)
                      : 0;
                    return (
                      <div key={row.name}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="max-w-[60%] truncate font-medium text-foreground">
                            {row.name}
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {fmtUsd(row.revCents)}
                            <span className="ml-2 text-muted-foreground/60">({row.count})</span>
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary/70 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Attribution breakdown */}
            <section className="rounded-xl border bg-card p-5">
              <SectionHeader icon={Award} title="Attribution Breakdown" />

              {/* Attributed vs unattributed */}
              <div className="mb-5 grid grid-cols-2 gap-3">
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <p className="text-xl font-bold tabular-nums text-foreground">{attributedPct}%</p>
                  <p className="text-[11px] text-muted-foreground">Partner-attributed</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <p className="text-xl font-bold tabular-nums text-foreground">{100 - attributedPct}%</p>
                  <p className="text-[11px] text-muted-foreground">Unattributed</p>
                </div>
              </div>

              {/* Top partners */}
              {topPartners.length > 0 && (
                <>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Top partners by attributed revenue
                  </p>
                  <div className="space-y-2">
                    {topPartners.map((tp) => {
                      const pct = totalRevenueCents > 0
                        ? Math.round((tp.revCents / totalRevenueCents) * 100)
                        : 0;
                      return (
                        <div key={tp.name}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="max-w-[55%] truncate font-medium text-foreground">{tp.name}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {fmtUsd(tp.revCents)}
                              <span className="ml-2 text-muted-foreground/60">({tp.count})</span>
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-violet-500/60 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {topPartners.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No attributed sales yet. Share partner referral codes to track attribution.
                </p>
              )}
            </section>
          </div>

          {/* ── Bottom row: Recent purchases + Recent commissions ── */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Recent purchases */}
            <section className="rounded-xl border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <SectionHeader icon={ShoppingBag} title="Recent Purchases" />
                <Link
                  href="/agency/marketplace-purchases"
                  className="text-xs text-primary hover:underline"
                >
                  View all
                </Link>
              </div>
              {recentPurchases.length === 0 ? (
                <p className="text-sm text-muted-foreground">No purchases yet.</p>
              ) : (
                <div className="space-y-1">
                  {recentPurchases.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-lg px-2 py-2 text-xs hover:bg-muted/30"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{p.productName}</p>
                        <p className="text-muted-foreground">{fmtDate(p.createdAt)}</p>
                      </div>
                      <div className="ml-3 flex-shrink-0 text-right">
                        <p className="tabular-nums font-medium text-foreground">
                          {fmtUsd(p.amountTotalCents)}
                        </p>
                        <span
                          className={cn(
                            "inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            p.paymentStatus === "paid"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                          )}
                        >
                          {p.paymentStatus === "paid" ? "Paid" : p.paymentStatus === "no_payment_required" ? "Free" : "Unpaid"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Recent commission events */}
            <section className="rounded-xl border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <SectionHeader icon={DollarSign} title="Recent Commission Events" />
                <Link
                  href="/agency/commissions"
                  className="text-xs text-primary hover:underline"
                >
                  View all
                </Link>
              </div>
              {recentCommissions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No commission events yet.
                  {process.env.NEXT_PUBLIC_PARTNER_COMMISSIONS_ENABLED !== "true" && (
                    <span className="ml-1 text-muted-foreground/60">
                      (PARTNER_COMMISSIONS_ENABLED is off)
                    </span>
                  )}
                </p>
              ) : (
                <div className="space-y-1">
                  {recentCommissions.map((e) => {
                    const partner = partners.find((p) => p.id === e.partnerProfileId);
                    const name = partner?.displayName ?? partner?.fullName ?? e.partnerProfileId;
                    return (
                      <div
                        key={e.id}
                        className="flex items-center justify-between rounded-lg px-2 py-2 text-xs hover:bg-muted/30"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{name}</p>
                          <p className="text-muted-foreground">{fmtDate(e.createdAt)}</p>
                        </div>
                        <div className="ml-3 flex-shrink-0 text-right">
                          <p className="tabular-nums font-medium text-foreground">
                            {fmtUsd(e.commissionCents)}
                          </p>
                          <span
                            className={cn(
                              "inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              e.status === "paid"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                                : e.status === "voided"
                                  ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                            )}
                          >
                            {e.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* ── Partner roster summary ── */}
          <section className="rounded-xl border bg-card p-5">
            <SectionHeader icon={Users} title="Partner Network" count={partners.length} />
            {partners.length === 0 ? (
              <p className="text-sm text-muted-foreground">No partner profiles enrolled yet.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(["active", "approved", "applied", "suspended"] as const).map((status) => {
                  const count = partners.filter((p) => p.status === status).length;
                  const styles: Record<string, string> = {
                    active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
                    approved: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
                    applied: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                    suspended: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
                  };
                  return (
                    <div key={status} className="rounded-lg border bg-muted/30 p-3">
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", styles[status])}>
                        {status}
                      </span>
                      <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{count}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
