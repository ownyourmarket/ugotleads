"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Coins,
  RotateCcw,
  Settings2,
  ShoppingBag,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { usePartnerProfile } from "@/hooks/use-partner-profile";
import {
  subscribeToCreditWallet,
  subscribeToCreditTransactions,
} from "@/lib/firestore/credits";
import type { CreditWallet, CreditTransaction, CreditTxnType } from "@/types/credits";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(value: unknown): string {
  if (!value) return "—";
  const ts = value as { toDate?: () => Date };
  const d = typeof ts.toDate === "function" ? ts.toDate() : (value as Date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const TXN_TYPE_CONFIG: Record<CreditTxnType, { label: string; icon: typeof Coins; color: string }> = {
  purchase: {
    label: "Purchase",
    icon: ArrowUpCircle,
    color: "text-emerald-600 dark:text-emerald-400",
  },
  spend: {
    label: "Spend",
    icon: ArrowDownCircle,
    color: "text-amber-600 dark:text-amber-400",
  },
  refund: {
    label: "Refund",
    icon: RotateCcw,
    color: "text-sky-600 dark:text-sky-400",
  },
  adjustment: {
    label: "Adjustment",
    icon: Settings2,
    color: "text-violet-600 dark:text-violet-400",
  },
  expiry: {
    label: "Expiry",
    icon: ArrowDownCircle,
    color: "text-zinc-500 dark:text-zinc-400",
  },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CreditWalletPage() {
  const { user } = useAuth();
  const { subAccountId } = useSubAccount();
  const { profile: partnerProfile, loading: partnerLoading } = usePartnerProfile(user?.uid);

  const [wallet, setWallet] = useState<CreditWallet | null | undefined>(undefined);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [txnLoading, setTxnLoading] = useState(true);

  useEffect(() => {
    if (!partnerProfile?.id) {
      setWallet(null);
      setTxnLoading(false);
      return;
    }
    const u1 = subscribeToCreditWallet(
      partnerProfile.id,
      (w) => setWallet(w),
      console.error,
    );
    setTxnLoading(true);
    const u2 = subscribeToCreditTransactions(
      partnerProfile.id,
      (txns) => { setTransactions(txns); setTxnLoading(false); },
      () => setTxnLoading(false),
    );
    return () => { u1(); u2(); };
  }, [partnerProfile?.id]);

  const loading = partnerLoading || wallet === undefined;

  // ── Not a partner ──────────────────────────────────────────────────────
  if (!loading && !partnerProfile) {
    return (
      <div className="min-h-screen p-6">
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-16 text-center">
          <Coins className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-foreground">No partner profile found.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Credit wallets are available to enrolled partners. Contact your agency owner to get started.
            </p>
          </div>
          <Link
            href={`/sa/${subAccountId}/marketplace/partner`}
            className="text-xs text-primary underline underline-offset-2"
          >
            Partner Profile
          </Link>
        </div>
      </div>
    );
  }

  // ── No wallet yet ──────────────────────────────────────────────────────
  if (!loading && wallet === null) {
    return (
      <div className="min-h-screen p-6 space-y-6">
        <div>
          <div className="mb-1 flex items-center gap-2 text-muted-foreground">
            <Coins className="h-4 w-4" />
            <span className="text-sm font-medium uppercase tracking-wider">Revenue OS</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Credit Wallet</h1>
        </div>
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-16 text-center">
          <Coins className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-foreground">No credit wallet yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your wallet will appear here once your agency owner initializes it.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-8 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-muted-foreground">
            <Coins className="h-4 w-4" />
            <span className="text-sm font-medium uppercase tracking-wider">Revenue OS</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Credit Wallet</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your credit balance and transaction history.
          </p>
        </div>
        <Link
          href={`/sa/${subAccountId}/marketplace`}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ShoppingBag className="h-3.5 w-3.5" />
          Marketplace
        </Link>
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      )}

      {!loading && wallet && (
        <>
          {/* Balance + stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Current balance — prominent */}
            <div className="col-span-full rounded-xl border bg-gradient-to-br from-violet-50 to-indigo-50 p-5 dark:from-violet-950/20 dark:to-indigo-950/20 sm:col-span-1 lg:col-span-2">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-violet-700 dark:text-violet-300">
                Current balance
              </p>
              <p className="text-4xl font-bold tabular-nums text-violet-800 dark:text-violet-200">
                {wallet.balanceCredits.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-violet-600 dark:text-violet-400">credits</p>
            </div>

            <div className="rounded-xl border bg-card p-4">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Lifetime purchased
              </p>
              <p className="text-xl font-bold tabular-nums text-foreground">
                {wallet.lifetimePurchasedCredits.toLocaleString()}
              </p>
            </div>

            <div className="rounded-xl border bg-card p-4">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Lifetime spent
              </p>
              <p className="text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                {wallet.lifetimeSpentCredits.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Transaction history */}
          <section>
            <h2 className="mb-4 text-sm font-semibold text-foreground">Transaction history</h2>
            {txnLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded-xl border bg-muted/40" />
                ))}
              </div>
            ) : transactions.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
                <Coins className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No transactions yet.</p>
              </div>
            ) : (
              <div className="rounded-xl border bg-card">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium">Description</th>
                        <th className="px-4 py-3 font-medium">Delta</th>
                        <th className="px-4 py-3 font-medium">Balance after</th>
                        <th className="px-4 py-3 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {transactions.map((txn) => {
                        const config = TXN_TYPE_CONFIG[txn.type] ?? {
                          label: txn.type,
                          icon: Coins,
                          color: "text-muted-foreground",
                        };
                        const TxnIcon = config.icon;
                        return (
                          <tr key={txn.id} className="hover:bg-muted/20">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <TxnIcon className={cn("h-3.5 w-3.5", config.color)} />
                                <span className="text-xs text-muted-foreground">{config.label}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-foreground">{txn.description}</td>
                            <td className="px-4 py-3">
                              <span
                                className={cn(
                                  "font-mono text-xs font-medium tabular-nums",
                                  txn.delta >= 0
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-red-600 dark:text-red-400",
                                )}
                              >
                                {txn.delta >= 0 ? "+" : ""}{txn.delta.toLocaleString()}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                              {txn.balanceAfter.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {fmtDate(txn.createdAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
