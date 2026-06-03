"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Receipt,
  ShoppingBag,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { subscribeToAgencyPurchases } from "@/lib/firestore/marketplace-purchases";
import type { MarketplacePurchase } from "@/types/marketplace";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterKey = "all" | "paid" | "unpaid" | "attributed" | "unattributed" | string;

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(value: unknown): string {
  if (!value) return "—";
  const ts = value as { toDate?: () => Date };
  const date = typeof ts.toDate === "function" ? ts.toDate() : (value as Date);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

function PaymentBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    unpaid: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    no_payment_required:
      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  };
  const labels: Record<string, string> = {
    paid: "Paid",
    unpaid: "Unpaid",
    no_payment_required: "Free",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        styles[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {labels[status] ?? status}
    </span>
  );
}

function CheckoutBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    complete: {
      label: "Complete",
      cls: "text-emerald-600 dark:text-emerald-400",
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    open: {
      label: "Open",
      cls: "text-amber-600 dark:text-amber-400",
      icon: <Clock className="h-3 w-3" />,
    },
    expired: {
      label: "Expired",
      cls: "text-zinc-500 dark:text-zinc-400",
      icon: <XCircle className="h-3 w-3" />,
    },
  };
  const config = map[status] ?? { label: status, cls: "text-muted-foreground", icon: null };
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", config.cls)}>
      {config.icon}
      {config.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------

const BASE_FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "unpaid", label: "Unpaid" },
  { key: "attributed", label: "Attributed" },
  { key: "unattributed", label: "Unattributed" },
];

function applyFilter(
  purchases: MarketplacePurchase[],
  filter: FilterKey,
): MarketplacePurchase[] {
  switch (filter) {
    case "all":
      return purchases;
    case "paid":
      return purchases.filter((p) => p.paymentStatus === "paid");
    case "unpaid":
      return purchases.filter((p) => p.paymentStatus === "unpaid");
    case "attributed":
      return purchases.filter((p) => !!p.referredByPartnerProfileId);
    case "unattributed":
      return purchases.filter((p) => !p.referredByPartnerProfileId);
    default:
      // productFamily filter
      return purchases.filter((p) => p.productFamily === filter);
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgencyMarketplacePurchasesPage() {
  const { agencyId, agencyRole } = useAuth();

  const [purchases, setPurchases] = useState<MarketplacePurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

  // Only agency owners may view this page
  const isOwner = agencyRole === "owner";

  useEffect(() => {
    if (!agencyId || !isOwner) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeToAgencyPurchases(
      agencyId,
      (data) => {
        setPurchases(data);
        setLoading(false);
      },
      (err) => {
        console.error("[agency/marketplace-purchases] subscribe:", err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [agencyId, isOwner]);

  // Derive product family filter chips dynamically
  const productFamilies = useMemo(
    () =>
      Array.from(
        new Set(
          purchases
            .map((p) => p.productFamily ?? null)
            .filter((f): f is NonNullable<typeof f> => f !== null),
        ),
      ).sort(),
    [purchases],
  );

  const allFilters: { key: FilterKey; label: string }[] = [
    ...BASE_FILTERS,
    ...productFamilies.map((f) => ({
      key: String(f) as FilterKey,
      label: String(f).charAt(0).toUpperCase() + String(f).slice(1),
    })),
  ];

  const filtered = useMemo(
    () => applyFilter(purchases, activeFilter),
    [purchases, activeFilter],
  );

  // Summary stats (always from the full set, not filtered)
  const totalPaid = purchases.filter((p) => p.paymentStatus === "paid").length;
  const totalVolumeCents = purchases
    .filter((p) => p.paymentStatus === "paid")
    .reduce((sum, p) => sum + p.amountTotalCents, 0);
  const totalAttributed = purchases.filter((p) => !!p.referredByPartnerProfileId).length;

  // ---- Access guard ----
  if (!isOwner) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <Receipt className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground">
          Agency owner access required.
        </p>
        <Link
          href="/agency"
          className="text-xs text-primary underline underline-offset-2"
        >
          Back to agency
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-8 p-6">
      {/* ---- Header ---- */}
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-muted-foreground">
            <ShoppingBag className="h-4 w-4" />
            <span className="text-sm font-medium uppercase tracking-wider">
              Revenue OS — Agency
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Marketplace Purchases
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All product purchases across your agency.
          </p>
        </div>

        <Link
          href="/agency"
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Agency
        </Link>
      </div>

      {/* ---- Summary cards ---- */}
      {!loading && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Paid sales
            </p>
            <p className="text-xl font-bold tabular-nums text-foreground">{totalPaid}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Revenue collected
            </p>
            <p className="text-xl font-bold tabular-nums text-foreground">
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                minimumFractionDigits: 2,
              }).format(totalVolumeCents / 100)}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Partner-attributed
            </p>
            <p className="text-xl font-bold tabular-nums text-foreground">
              {totalAttributed}
            </p>
          </div>
        </div>
      )}

      {/* ---- Filter chips ---- */}
      {!loading && purchases.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {allFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setActiveFilter(f.key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                activeFilter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* ---- Loading skeleton ---- */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      )}

      {/* ---- Empty state ---- */}
      {!loading && purchases.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-16 text-center">
          <Receipt className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-foreground">No purchases yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Completed marketplace checkouts will appear here.
            </p>
          </div>
        </div>
      )}

      {/* ---- Table ---- */}
      {!loading && filtered.length > 0 && (
        <div className="rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Sub-account</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Partner code</th>
                  <th className="px-4 py-3 font-medium">Commission</th>
                  <th className="px-4 py-3 font-medium">Fulfillment</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{p.productName}</div>
                      {p.productFamily && (
                        <div className="text-[11px] text-muted-foreground capitalize">
                          {p.productFamily}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {p.subAccountId}
                      </code>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-foreground">
                      {formatCents(p.amountTotalCents, p.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <PaymentBadge status={p.paymentStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <CheckoutBadge status={p.checkoutStatus} />
                    </td>
                    <td className="px-4 py-3">
                      {p.partnerReferralCode ? (
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tracking-widest text-foreground">
                          {p.partnerReferralCode}
                        </code>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.commissionEventId ? (
                        <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                          Linked
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.fulfilledAt ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" />
                          Fulfilled
                        </span>
                      ) : p.paymentStatus === "paid" ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                          title="Paid purchase with no entitlement — fulfillment may have failed or rules/deploy pending."
                        >
                          <AlertTriangle className="h-3 w-3" />
                          Not fulfilled
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(p.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length < purchases.length && (
            <div className="border-t px-4 py-3 text-xs text-muted-foreground">
              Showing {filtered.length} of {purchases.length} total purchases
            </div>
          )}
        </div>
      )}

      {/* ---- Filtered empty state ---- */}
      {!loading && purchases.length > 0 && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-10 text-center">
          <p className="text-sm text-muted-foreground">
            No purchases match this filter.
          </p>
          <button
            type="button"
            onClick={() => setActiveFilter("all")}
            className="text-xs text-primary underline underline-offset-2"
          >
            Clear filter
          </button>
        </div>
      )}
    </div>
  );
}
