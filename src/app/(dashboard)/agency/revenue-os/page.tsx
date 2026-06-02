"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Award,
  BarChart3,
  CheckCircle2,
  Clock,
  DollarSign,
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

  useEffect(() => {
    if (!agencyId || !isOwner) { setLoading(false); return; }

    let doneCount = 0;
    const check = () => { if (++doneCount === 3) setLoading(false); };

    const u1 = subscribeToAgencyPurchases(agencyId, (d) => { setPurchases(d); check(); }, () => check());
    const u2 = subscribeToAgencyCommissionEvents(agencyId, (d) => { setCommissionEvents(d); check(); }, () => check());
    const u3 = subscribeToPartnerProfiles(agencyId, (d) => { setPartners(d); check(); }, () => check());

    return () => { u1(); u2(); u3(); };
  }, [agencyId, isOwner]);

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
