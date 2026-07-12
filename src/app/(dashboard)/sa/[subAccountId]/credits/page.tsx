"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
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
import { CREDIT_PACKS, type CreditPack } from "@/types";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Buy credits panel
// ---------------------------------------------------------------------------

const SKILL_RUN_CREDIT_COST = 5;

function BuyCreditsPanel({
  buyingPackId,
  onBuy,
}: {
  buyingPackId: string | null;
  onBuy: (pack: CreditPack) => void;
}) {
  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold text-foreground">Buy credits</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {CREDIT_PACKS.map((pack) => {
          const isBuying = buyingPackId === pack.id;
          const isDisabled = buyingPackId !== null;
          return (
            <div
              key={pack.id}
              className="flex flex-col justify-between rounded-xl border bg-card p-5"
            >
              <div>
                <p className="text-sm font-semibold text-foreground">{pack.name}</p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">
                  {pack.credits.toLocaleString()}{" "}
                  <span className="text-sm font-medium text-muted-foreground">credits</span>
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  ${(pack.priceUsdCents / 100).toFixed(pack.priceUsdCents % 100 === 0 ? 0 : 2)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  ≈ {Math.floor(pack.credits / SKILL_RUN_CREDIT_COST)} skill runs at {SKILL_RUN_CREDIT_COST} credits
                </p>
              </div>
              <button
                type="button"
                onClick={() => onBuy(pack)}
                disabled={isDisabled}
                className={cn(
                  "mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium",
                  "bg-primary text-primary-foreground hover:bg-primary/90",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {isBuying ? "Redirecting…" : "Buy"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

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
  const [buyingPackId, setBuyingPackId] = useState<string | null>(null);

  // ── Top-up return toast (?topup=success|cancelled) ─────────────────────
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const topupToastShown = useRef(false);

  useEffect(() => {
    const topup = searchParams?.get("topup");
    if (!topup || topupToastShown.current) return;
    topupToastShown.current = true;
    if (topup === "success") {
      toast.success("Payment received — credits land within a minute.");
    } else if (topup === "cancelled") {
      toast("Checkout cancelled.");
    }
    const params = new URLSearchParams(searchParams?.toString());
    params.delete("topup");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [searchParams, router, pathname]);

  async function handleBuyPack(pack: CreditPack) {
    if (buyingPackId) return;
    setBuyingPackId(pack.id);
    try {
      const res = await fetch("/api/credits/topup/checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId: pack.id, subAccountId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
        note?: string;
      };
      if (res.status === 503) {
        toast.error(data.error ?? data.note ?? "Credit top-up checkout is not configured.");
        return;
      }
      if (!res.ok || !data.url) {
        toast.error("Could not start checkout — try again.");
        return;
      }
      window.location.assign(data.url);
    } catch {
      toast.error("Could not start checkout — try again.");
    } finally {
      setBuyingPackId(null);
    }
  }

  // Wallet doc id === partner_profiles doc id === uid by convention (see
  // use-partner-profile.ts). Fall back to the auth uid directly so a
  // purchased wallet (written to credit_wallets/{purchaserUid} by the top-up
  // fulfillment) is still found for users who don't have a partner profile.
  const walletId = partnerProfile?.id ?? user?.uid ?? null;

  useEffect(() => {
    if (!walletId) {
      setWallet(null);
      setTxnLoading(false);
      return;
    }
    const u1 = subscribeToCreditWallet(
      walletId,
      (w) => setWallet(w),
      console.error,
    );
    setTxnLoading(true);
    const u2 = subscribeToCreditTransactions(
      walletId,
      (txns) => { setTransactions(txns); setTxnLoading(false); },
      () => setTxnLoading(false),
    );
    return () => { u1(); u2(); };
  }, [walletId]);

  const loading = partnerLoading || wallet === undefined;

  // ── Not a partner, and no wallet exists either ─────────────────────────
  if (!loading && !partnerProfile && wallet === null) {
    return (
      <div className="min-h-screen space-y-8 p-6">
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
        <BuyCreditsPanel buyingPackId={buyingPackId} onBuy={handleBuyPack} />
      </div>
    );
  }

  // ── Has a partner profile, but wallet not initialized yet ──────────────
  if (!loading && partnerProfile && wallet === null) {
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
              Buy a credit pack below to activate your wallet — or ask your agency owner to initialize it.
            </p>
          </div>
        </div>
        <BuyCreditsPanel buyingPackId={buyingPackId} onBuy={handleBuyPack} />
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

      {/* No partner profile note — wallet still shown below when present */}
      {!loading && !partnerProfile && (
        <div className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
          No partner profile found. Some partner-specific features are unavailable.{" "}
          <Link
            href={`/sa/${subAccountId}/marketplace/partner`}
            className="text-primary underline underline-offset-2"
          >
            Set up a partner profile
          </Link>
        </div>
      )}

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

          {/* Buy credits */}
          <BuyCreditsPanel buyingPackId={buyingPackId} onBuy={handleBuyPack} />

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
