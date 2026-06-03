"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Receipt,
  ShoppingBag,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { subscribeToSubAccountPurchases } from "@/lib/firestore/marketplace-purchases";
import type { MarketplacePurchase } from "@/types/marketplace";
import { cn } from "@/lib/utils";

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

function CommissionBadge({ commissionEventId }: { commissionEventId: string | null }) {
  if (!commissionEventId) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
      Commission linked
    </span>
  );
}

function FulfilledBadge({ fulfilledAt }: { fulfilledAt: unknown }) {
  if (!fulfilledAt) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
      <CheckCircle2 className="h-3 w-3" />
      Fulfilled
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SubAccountMarketplacePurchasesPage() {
  const { agencyId } = useAuth();
  const { subAccountId } = useSubAccount();

  const [purchases, setPurchases] = useState<MarketplacePurchase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!subAccountId) return;
    setLoading(true);
    const unsub = subscribeToSubAccountPurchases(
      subAccountId,
      (data) => {
        setPurchases(data);
        setLoading(false);
      },
      (err) => {
        console.error("[marketplace/purchases] subscribe:", err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [subAccountId]);

  // Suppress unused warning — agencyId flows through auth context
  void agencyId;

  return (
    <div className="min-h-screen space-y-8 p-6">
      {/* ---- Header ---- */}
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-muted-foreground">
            <ShoppingBag className="h-4 w-4" />
            <span className="text-sm font-medium uppercase tracking-wider">
              Revenue OS
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Purchase History
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All marketplace purchases for this account.
          </p>
        </div>

        <Link
          href={`/sa/${subAccountId}/marketplace`}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ShoppingBag className="h-3.5 w-3.5" />
          Marketplace
        </Link>
      </div>

      {/* ---- Loading skeleton ---- */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
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
          <Link
            href={`/sa/${subAccountId}/marketplace`}
            className="inline-flex items-center gap-1.5 text-xs text-primary underline underline-offset-2"
          >
            Browse products
          </Link>
        </div>
      )}

      {/* ---- Table ---- */}
      {!loading && purchases.length > 0 && (
        <div className="rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Referred by</th>
                  <th className="px-4 py-3 font-medium">Commission</th>
                  <th className="px-4 py-3 font-medium">Fulfillment</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {purchases.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{p.productName}</div>
                      {p.productFamily && (
                        <div className="text-[11px] text-muted-foreground capitalize">
                          {p.productFamily}
                        </div>
                      )}
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
                      <CommissionBadge commissionEventId={p.commissionEventId} />
                    </td>
                    <td className="px-4 py-3">
                      <FulfilledBadge fulfilledAt={p.fulfilledAt} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(p.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
