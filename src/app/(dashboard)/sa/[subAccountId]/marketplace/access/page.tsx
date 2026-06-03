"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Award,
  BookOpen,
  CheckCircle2,
  Coins,
  Key,
  Package,
  Receipt,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { subscribeToCustomerEntitlements } from "@/lib/firestore/entitlements";
import { subscribeToSubAccountPurchases } from "@/lib/firestore/marketplace-purchases";
import type { ProductEntitlement } from "@/types/products";
import type { MarketplacePurchase } from "@/types/marketplace";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatDate(value: unknown): string {
  if (!value) return "—";
  const ts = value as { toDate?: () => Date };
  const date = typeof ts.toDate === "function" ? ts.toDate() : (value as Date);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const FAMILY_LABELS: Record<string, string> = {
  ugotleads_software: "uGotLeads Software",
  myusa_education: "MyUSA Education",
  myusa_services: "MyUSA Services",
  myusa_resources: "MyUSA Resources",
  myusa_media_products: "MyUSA Media",
};

// ---------------------------------------------------------------------------
// Access-button resolver
// ---------------------------------------------------------------------------

interface AccessAction {
  label: string;
  href: string | null;        // null = no destination (coming soon)
  icon: typeof Package;
  primary: boolean;
}

/**
 * Resolves the "access product" button for an entitlement based on product
 * family first, then access model. Education products always route to Training.
 */
function resolveAccessAction(
  ent: ProductEntitlement,
  subAccountId: string,
): AccessAction {
  const sa = `/sa/${subAccountId}`;

  // 1. Education / training products → Training dashboard
  if (ent.productFamily === "myusa_education") {
    return { label: "Go to Training", href: `${sa}/training`, icon: BookOpen, primary: true };
  }

  // 2. By access model
  if (ent.accessModel === "byok") {
    return {
      label: "Set up API key",
      href: `${sa}/marketplace/products/${ent.productId}`,
      icon: Key,
      primary: true,
    };
  }
  if (ent.accessModel === "credit") {
    return { label: "View Credits", href: `${sa}/credits`, icon: Coins, primary: true };
  }
  if (ent.accessModel === "subscription") {
    return {
      label: "Open Revenue Cockpit",
      href: `${sa}/marketplace/cockpit`,
      icon: TrendingUp,
      primary: true,
    };
  }

  // 3. Services / media / resources → product detail (onboarding lands later)
  return {
    label: "View details",
    href: `${sa}/marketplace/products/${ent.productId}`,
    icon: Package,
    primary: false,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MyProductsAccessPage() {
  const { user } = useAuth();
  const { subAccountId } = useSubAccount();

  const [entitlements, setEntitlements] = useState<ProductEntitlement[]>([]);
  const [purchases, setPurchases] = useState<MarketplacePurchase[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Customer's own entitlements ──────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeToCustomerEntitlements(
      user.uid,
      (data) => {
        setEntitlements(data);
        setLoading(false);
      },
      (err) => {
        console.error("[access] subscribeToCustomerEntitlements:", err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [user?.uid]);

  // ── Purchases (for linking entitlement → purchase by granting session) ────
  useEffect(() => {
    if (!subAccountId) return;
    const unsub = subscribeToSubAccountPurchases(
      subAccountId,
      (data) => setPurchases(data),
      (err) => console.error("[access] subscribeToSubAccountPurchases:", err),
    );
    return () => unsub();
  }, [subAccountId]);

  // Map grantingSessionId → purchase for quick lookup
  const purchaseBySession = useMemo(
    () => new Map(purchases.map((p) => [p.stripeSessionId, p])),
    [purchases],
  );

  // Active entitlements scoped to this sub-account, sorted newest-first
  const activeEntitlements = useMemo(() => {
    return entitlements
      .filter((e) => e.status === "active")
      .filter((e) => !e.subAccountId || e.subAccountId === subAccountId)
      .sort((a, b) => {
        const ad = (a.grantedAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
        const bd = (b.grantedAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
        return bd - ad;
      });
  }, [entitlements, subAccountId]);

  return (
    <div className="min-h-screen space-y-8 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-muted-foreground">
            <Package className="h-4 w-4" />
            <span className="text-sm font-medium uppercase tracking-wider">Revenue OS</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">My Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Products you have access to. Open one to get started.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/sa/${subAccountId}/marketplace/purchases`}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Receipt className="h-3.5 w-3.5" />
            Purchases
          </Link>
          <Link
            href={`/sa/${subAccountId}/marketplace`}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            Marketplace
          </Link>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && activeEntitlements.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-16 text-center">
          <Package className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-foreground">No products yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Products you purchase from the marketplace will appear here once payment is confirmed.
            </p>
          </div>
          <Link
            href={`/sa/${subAccountId}/marketplace`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            Browse the marketplace
          </Link>
        </div>
      )}

      {/* Entitlement cards */}
      {!loading && activeEntitlements.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2">
          {activeEntitlements.map((ent) => {
            const action = resolveAccessAction(ent, subAccountId);
            const ActionIcon = action.icon;
            const purchase = ent.grantingSessionId
              ? purchaseBySession.get(ent.grantingSessionId)
              : undefined;

            return (
              <div
                key={ent.id}
                className="flex flex-col rounded-xl border bg-card p-5 transition-shadow hover:shadow-md"
              >
                {/* Header */}
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-500" />
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {ent.productName}
                      </h3>
                    </div>
                    {ent.productFamily && (
                      <span className="text-[11px] text-muted-foreground">
                        {FAMILY_LABELS[ent.productFamily] ?? ent.productFamily}
                      </span>
                    )}
                  </div>
                  <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    Active
                  </span>
                </div>

                {/* Meta */}
                <dl className="mb-4 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Access model</dt>
                    <dd className="font-medium capitalize text-foreground">{ent.accessModel}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Granted</dt>
                    <dd className="text-foreground">{formatDate(ent.grantedAt)}</dd>
                  </div>
                  {purchase && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Purchase</dt>
                      <dd>
                        <Link
                          href={`/sa/${subAccountId}/marketplace/purchases`}
                          className="text-primary hover:underline"
                        >
                          View receipt
                        </Link>
                      </dd>
                    </div>
                  )}
                </dl>

                {/* Access button */}
                <div className="mt-auto">
                  {action.href ? (
                    <Link
                      href={action.href}
                      className={cn(
                        "inline-flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-colors",
                        action.primary
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : "border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <ActionIcon className="h-3.5 w-3.5" />
                      {action.label}
                    </Link>
                  ) : (
                    <div className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-2 text-xs text-muted-foreground">
                      <Award className="h-3.5 w-3.5" />
                      Onboarding coming soon
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
