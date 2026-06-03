"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  Package,
  Receipt,
  ShoppingBag,
} from "lucide-react";
import { useSubAccount } from "@/context/sub-account-context";
import { getProduct } from "@/lib/firestore/products";
import type { Product } from "@/types/products";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Safe Stripe session shape (from /api/marketplace/checkout/session)
// ---------------------------------------------------------------------------

interface SafeSession {
  id: string;
  status: "open" | "complete" | "expired";
  payment_status: "paid" | "unpaid" | "no_payment_required";
  amount_total: number | null;
  currency: string | null;
  metadata: {
    productId: string | null;
    productFamily: string | null;
    subAccountId: string | null;
    referredByPartnerProfileId: string | null;
    partnerReferralCode: string | null;
  };
}

function fmtUsd(cents: number | null, currency: string | null): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CheckoutSuccessPage() {
  const searchParams = useSearchParams();
  const { subAccountId } = useSubAccount();

  const sessionId = searchParams?.get("session_id") ?? null;
  const productIdParam = searchParams?.get("productId") ?? null;

  const [session, setSession] = useState<SafeSession | null | "loading">("loading");
  const [product, setProduct] = useState<Product | null>(null);

  // ── Fetch Stripe session (test mode only) ─────────────────────────────────
  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return;
    }
    fetch(`/api/marketplace/checkout/session?session_id=${encodeURIComponent(sessionId)}`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((data: { ok?: boolean; session?: SafeSession; error?: string }) => {
        setSession(data.ok && data.session ? data.session : null);
      })
      .catch(() => setSession(null));
  }, [sessionId]);

  // ── Load product name ─────────────────────────────────────────────────────
  const resolvedProductId = productIdParam;
  useEffect(() => {
    if (!resolvedProductId) return;
    getProduct(resolvedProductId)
      .then((p) => setProduct(p))
      .catch(() => setProduct(null));
  }, [resolvedProductId]);

  const isLoading = session === "loading";
  const isPaid = session !== "loading" && session?.payment_status === "paid";
  const isComplete = session !== "loading" && session?.status === "complete";
  const isProcessing = !isLoading && !isPaid && session !== null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">

        {/* ── Status card ── */}
        <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
          {isLoading ? (
            <div className="flex flex-col items-center gap-4">
              <div className="h-16 w-16 animate-pulse rounded-full bg-muted/60" />
              <div className="h-5 w-48 animate-pulse rounded bg-muted/60" />
              <div className="h-3 w-64 animate-pulse rounded bg-muted/60" />
            </div>
          ) : isPaid && isComplete ? (
            // ── Confirmed payment ──
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Payment confirmed!
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {product?.name
                    ? `Thank you for purchasing ${product.name}.`
                    : "Your purchase is confirmed."}
                </p>
              </div>
              {session?.amount_total !== null && (
                <div className="rounded-xl border bg-muted/30 px-5 py-3 text-center">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Amount paid
                  </p>
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {fmtUsd(session.amount_total, session.currency)}
                  </p>
                </div>
              )}
            </div>
          ) : isProcessing ? (
            // ── Payment processing ──
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <Clock className="h-8 w-8 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Payment processing
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your payment is being processed. This usually takes a moment.
                </p>
              </div>
            </div>
          ) : (
            // ── No session or unable to verify ──
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Checkout complete
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {product?.name
                    ? `You completed checkout for ${product.name}.`
                    : "Your checkout was completed."}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Next steps ── */}
        {!isLoading && (
          <div className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Next steps</h2>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                Your purchase will appear in <strong className="text-foreground">My Purchases</strong> within a few seconds.
              </li>
              <li className="flex items-start gap-2">
                <Package className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                Access to your product will be configured automatically once payment is confirmed.
              </li>
              {session?.metadata?.partnerReferralCode && (
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-violet-500" />
                  Referral code <code className="rounded bg-muted px-1 font-mono text-xs">
                    {session.metadata.partnerReferralCode}
                  </code> was applied to this purchase.
                </li>
              )}
            </ul>
          </div>
        )}

        {/* ── Actions ── */}
        <div className="flex flex-col gap-2">
          <Link
            href={`/sa/${subAccountId}/marketplace/purchases`}
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium",
              "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            <Receipt className="h-4 w-4" />
            View My Purchases
          </Link>
          <Link
            href={`/sa/${subAccountId}/marketplace`}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ShoppingBag className="h-4 w-4" />
            Back to Marketplace
          </Link>
          {resolvedProductId && (
            <Link
              href={`/sa/${subAccountId}/marketplace/products/${resolvedProductId}`}
              className="text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Return to product page
            </Link>
          )}
        </div>

        {/* Session ID for support reference */}
        {sessionId && (
          <p className="text-center text-[11px] text-muted-foreground/50">
            Reference: <code className="font-mono">{sessionId}</code>
          </p>
        )}
      </div>
    </div>
  );
}
