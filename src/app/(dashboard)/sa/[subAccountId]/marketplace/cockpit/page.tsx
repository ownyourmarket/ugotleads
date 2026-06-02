"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Award,
  BarChart3,
  DollarSign,
  Receipt,
  ShoppingBag,
  TrendingUp,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { usePartnerProfile } from "@/hooks/use-partner-profile";
import { subscribeToSubAccountPurchases } from "@/lib/firestore/marketplace-purchases";
import type { MarketplacePurchase } from "@/types/marketplace";
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MarketplaceCockpitPage() {
  const { user } = useAuth();
  const { subAccountId } = useSubAccount();

  const [purchases, setPurchases] = useState<MarketplacePurchase[]>([]);
  const [loading, setLoading] = useState(true);

  // Partner profile for this user (may be null if not enrolled)
  const { profile: partnerProfile, loading: partnerLoading } = usePartnerProfile(user?.uid);

  useEffect(() => {
    if (!subAccountId) { setLoading(false); return; }
    setLoading(true);
    const unsub = subscribeToSubAccountPurchases(
      subAccountId,
      (data) => { setPurchases(data); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, [subAccountId]);

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
  const unattributedCount = paidPurchases.length - attributedCount;
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

  const recentPurchases = purchases.slice(0, 8);
  const isLoading = loading || partnerLoading;

  return (
    <div className="min-h-screen space-y-8 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-muted-foreground">
            <ShoppingBag className="h-4 w-4" />
            <span className="text-sm font-medium uppercase tracking-wider">Revenue OS</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Marketplace Cockpit
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your sub-account's marketplace activity at a glance.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/sa/${subAccountId}/marketplace/purchases`}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Receipt className="h-3.5 w-3.5" />
            My purchases
          </Link>
          <Link
            href={`/sa/${subAccountId}/marketplace`}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            Marketplace
          </Link>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      )}

      {!isLoading && (
        <>
          {/* ── Stat cards ── */}
          <div className={cn(
            "grid gap-4",
            partnerProfile ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3",
          )}>
            <StatCard
              label="Revenue spent"
              value={fmtUsd(totalRevenueCents)}
              sub={`${paidPurchases.length} paid purchase${paidPurchases.length !== 1 ? "s" : ""}`}
              icon={DollarSign}
            />
            <StatCard
              label="Products purchased"
              value={String(productRows.length)}
              sub={purchases.length > paidPurchases.length ? `${purchases.length - paidPurchases.length} incomplete` : "all paid"}
              icon={ShoppingBag}
            />
            <StatCard
              label="Attributed to partner"
              value={`${attributedPct}%`}
              sub={`${attributedCount} attributed · ${unattributedCount} direct`}
              icon={Award}
            />
            {partnerProfile && (
              <StatCard
                label="Your pending commissions"
                value={fmtUsd(partnerProfile.pendingCommissionCents)}
                sub={`${fmtUsd(partnerProfile.lifetimeCommissionCents)} lifetime`}
                icon={TrendingUp}
                accent="text-amber-600 dark:text-amber-400"
              />
            )}
          </div>

          {/* ── Middle row: Product performance + Attribution ── */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Product performance */}
            <section className="rounded-xl border bg-card p-5">
              <div className="mb-4 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Product Performance</h2>
                <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                  {productRows.length}
                </span>
              </div>
              {productRows.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-10 text-center">
                  <BarChart3 className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No paid purchases yet.</p>
                  <Link
                    href={`/sa/${subAccountId}/marketplace`}
                    className="text-xs text-primary underline underline-offset-2"
                  >
                    Browse products
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {productRows.map((row) => {
                    const pct = totalRevenueCents > 0
                      ? Math.round((row.revCents / totalRevenueCents) * 100)
                      : 0;
                    return (
                      <div key={row.name}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <div className="min-w-0">
                            <span className="block truncate font-medium text-foreground">
                              {row.name}
                            </span>
                            {row.family && (
                              <span className="capitalize text-muted-foreground">{row.family}</span>
                            )}
                          </div>
                          <span className="ml-2 flex-shrink-0 tabular-nums text-muted-foreground">
                            {fmtUsd(row.revCents)}{" "}
                            <span className="text-muted-foreground/60">({row.count})</span>
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
              <div className="mb-4 flex items-center gap-2">
                <Award className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Attribution Breakdown</h2>
              </div>

              <div className="mb-5 grid grid-cols-2 gap-3">
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <p className="text-xl font-bold tabular-nums text-foreground">{attributedCount}</p>
                  <p className="text-[11px] text-muted-foreground">Partner-referred</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <p className="text-xl font-bold tabular-nums text-foreground">{unattributedCount}</p>
                  <p className="text-[11px] text-muted-foreground">Direct / unattributed</p>
                </div>
              </div>

              {/* Attribution bar */}
              {paidPurchases.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Attribution split
                  </p>
                  <div className="flex h-3 w-full overflow-hidden rounded-full">
                    <div
                      className="h-full bg-violet-500/70 transition-all"
                      style={{ width: `${attributedPct}%` }}
                    />
                    <div
                      className="h-full flex-1 bg-muted"
                    />
                  </div>
                  <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-full bg-violet-500/70" />
                      Attributed {attributedPct}%
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/30" />
                      Direct {100 - attributedPct}%
                    </span>
                  </div>
                </div>
              )}

              {paidPurchases.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Attribution data appears once you have paid purchases.
                </p>
              )}

              {/* Partner section hint */}
              {partnerProfile && (
                <div className="mt-4 rounded-lg border bg-violet-50 p-3 dark:bg-violet-950/20">
                  <div className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 flex-shrink-0 text-violet-600 dark:text-violet-400" />
                    <p className="text-xs text-violet-700 dark:text-violet-300">
                      You are an active partner. View your attributed sales on the{" "}
                      <Link
                        href={`/sa/${subAccountId}/marketplace/partner`}
                        className="font-medium underline underline-offset-2"
                      >
                        Partner Profile
                      </Link>{" "}
                      page.
                    </p>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* ── Recent purchases feed ── */}
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Recent Purchases</h2>
              </div>
              {purchases.length > 8 && (
                <Link
                  href={`/sa/${subAccountId}/marketplace/purchases`}
                  className="text-xs text-primary hover:underline"
                >
                  View all {purchases.length}
                </Link>
              )}
            </div>

            {recentPurchases.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-10 text-center">
                <ShoppingBag className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No purchases yet.</p>
                <Link
                  href={`/sa/${subAccountId}/marketplace`}
                  className="text-xs text-primary underline underline-offset-2"
                >
                  Browse the marketplace
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium">Product</th>
                      <th className="pb-2 pr-4 font-medium">Amount</th>
                      <th className="pb-2 pr-4 font-medium">Status</th>
                      <th className="pb-2 pr-4 font-medium">Referred by</th>
                      <th className="pb-2 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {recentPurchases.map((p) => (
                      <tr key={p.id} className="text-xs hover:bg-muted/30">
                        <td className="py-2.5 pr-4">
                          <span className="font-medium text-foreground">{p.productName}</span>
                          {p.productFamily && (
                            <span className="ml-1.5 capitalize text-muted-foreground">
                              · {p.productFamily}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 tabular-nums text-foreground">
                          {fmtUsd(p.amountTotalCents)}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              p.paymentStatus === "paid"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                            )}
                          >
                            {p.paymentStatus === "paid" ? "Paid" : p.paymentStatus === "no_payment_required" ? "Free" : "Unpaid"}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          {p.partnerReferralCode ? (
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tracking-widest">
                              {p.partnerReferralCode}
                            </code>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2.5 text-muted-foreground">
                          {fmtDate(p.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
