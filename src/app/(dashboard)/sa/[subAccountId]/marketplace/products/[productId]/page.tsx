"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Award,
  CheckCircle2,
  Clock,
  CreditCard,
  Eye,
  EyeOff,
  Key,
  RefreshCw,
  ShieldCheck,
  Tag,
  TrendingUp,
  XCircle,
  AlertTriangle,
  ShoppingBag,
  Zap,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { usePartnerProfile } from "@/hooks/use-partner-profile";
import { getProduct, getProductEligibility } from "@/lib/firestore/products";
import { subscribeToCommissionRules } from "@/lib/firestore/commission";
import { resolveCommissionRule, FAMILY_LABELS, FAMILY_COLORS } from "@/components/marketplace/product-card";
import { readPartnerRefCookie } from "@/lib/cookies/partner-ref";
import { cn } from "@/lib/utils";
import type { Product, ProductEligibility } from "@/types/products";
import type { CommissionRule } from "@/types/credits";

// ---------------------------------------------------------------------------
// Checkout readiness
// ---------------------------------------------------------------------------

type CheckoutReadiness =
  | "draft_product"         // product.status === "draft"
  | "available_soon"        // active but isPublic === false
  | "missing_stripe_price"  // subscription with no Stripe price IDs
  | "requires_certification"// education product, partner not approved
  | "eligible_to_purchase"  // non-partner; active + public
  | "eligible_to_sell"      // partner with approved eligibility
  | "test_checkout_ready";  // admin view: has price + no blocking issue

interface ReadinessConfig {
  label: string;
  description: string;
  icon: typeof CheckCircle2;
  className: string;
}

const READINESS_CONFIG: Record<CheckoutReadiness, ReadinessConfig> = {
  draft_product: {
    label: "Draft product",
    description: "This product is not yet published. Configure and publish it before it appears in the marketplace.",
    icon: XCircle,
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  },
  available_soon: {
    label: "Available soon",
    description: "This product is active but hidden from the marketplace. It will appear once it's made public.",
    icon: Clock,
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  },
  missing_stripe_price: {
    label: "Missing Stripe price",
    description: "No Stripe price ID is configured for this subscription product. A price ID is required before checkout can be activated.",
    icon: AlertTriangle,
    className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  },
  requires_certification: {
    label: "Requires certification",
    description: "You must complete the associated certification track before you can sell this product.",
    icon: Award,
    className: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  },
  eligible_to_purchase: {
    label: "Eligible to purchase",
    description: "This product is available. Contact your account manager or apply as a partner to sell it.",
    icon: CheckCircle2,
    className: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  },
  eligible_to_sell: {
    label: "Eligible to sell",
    description: "You're approved to sell this product. Use the checkout to create a test session.",
    icon: CheckCircle2,
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  test_checkout_ready: {
    label: "Test checkout ready",
    description: "This product is fully configured and ready for a test checkout session (admin view).",
    icon: Zap,
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
};

function resolveReadiness(
  product: Product,
  isAdmin: boolean,
  isPartner: boolean,
  eligibility: ProductEligibility | null | undefined,
): CheckoutReadiness {
  if (product.status === "draft") return "draft_product";
  if (!product.isPublic) return "available_soon";

  // Subscription products need at least one Stripe price ID for checkout
  if (
    product.accessModel === "subscription" &&
    !product.stripePriceIdMonthly &&
    !product.stripePriceIdAnnual
  ) {
    return "missing_stripe_price";
  }

  if (isAdmin && !isPartner) {
    // Admin non-partner view: if product is fully configured, show test_checkout_ready
    if (product.accessModel !== "subscription" || product.stripePriceIdMonthly || product.stripePriceIdAnnual) {
      return "test_checkout_ready";
    }
  }

  if (!isPartner) {
    return "eligible_to_purchase";
  }

  // Partner flow
  if (eligibility === undefined) {
    // Still loading — default to eligible_to_purchase as placeholder
    return "eligible_to_purchase";
  }

  if (eligibility?.status === "approved") {
    return "eligible_to_sell";
  }

  if (product.productFamily === "myusa_education") {
    return "requires_certification";
  }

  // pending / denied / revoked / no doc
  return "requires_certification";
}

// ---------------------------------------------------------------------------
// Billing label helper
// ---------------------------------------------------------------------------

function getBillingDescription(product: Product): string {
  if (product.accessModel === "credit") {
    return product.creditCostPerUnit > 0
      ? `${product.creditCostPerUnit} credit${product.creditCostPerUnit === 1 ? "" : "s"} per use`
      : "Free (credits)";
  }
  if (product.accessModel === "subscription") {
    const hasPrices = product.stripePriceIdMonthly || product.stripePriceIdAnnual;
    if (!hasPrices) return "Pricing not yet configured";
    const parts: string[] = [];
    if (product.stripePriceIdMonthly) parts.push("Monthly billing available");
    if (product.stripePriceIdAnnual) parts.push("Annual billing available");
    return parts.join(" · ");
  }
  if (product.accessModel === "byok") return "Bring Your Own Key — no platform billing";
  return "—";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProductDetailPage() {
  const params = useParams<{ subAccountId: string; productId: string }>();
  const productId = params?.productId ?? "";
  const router = useRouter();

  const { user, agencyRole } = useAuth();
  const { subAccountId, agencyId: saAgencyId } = useSubAccount();
  const { profile: partnerProfile, loading: partnerLoading } = usePartnerProfile(user?.uid);

  const isAdmin = agencyRole === "owner";
  const isPartner =
    !!partnerProfile &&
    (partnerProfile.status === "active" || partnerProfile.status === "approved");

  // ---- Product ----
  const [product, setProduct] = useState<Product | null | undefined>(undefined); // undefined = loading

  // ---- Eligibility ----
  const [eligibility, setEligibility] = useState<ProductEligibility | null | undefined>(undefined);

  // ---- Commission rules ----
  const [commissionRules, setCommissionRules] = useState<CommissionRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);

  // ---- Partner referral attribution ----
  // Read myusa_partner_ref cookie once on mount so the code is available
  // when the user clicks checkout. This is the MyUSA partner referral system —
  // NOT the LeadStack founders affiliate (ls_ref / referrals collection).
  const [partnerRefCode, setPartnerRefCode] = useState<string | null>(null);
  useEffect(() => {
    setPartnerRefCode(readPartnerRefCookie());
  }, []);

  // ---- Checkout state ----
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // ---- Load product ----
  useEffect(() => {
    if (!productId) return;
    setProduct(undefined);
    getProduct(productId)
      .then(setProduct)
      .catch((err) => {
        console.error("[product-detail] getProduct:", err);
        setProduct(null);
      });
  }, [productId]);

  // ---- Load eligibility (partner only) ----
  useEffect(() => {
    if (!isPartner || !partnerProfile?.id || !productId) {
      setEligibility(null);
      return;
    }
    setEligibility(undefined);
    getProductEligibility(partnerProfile.id, productId)
      .then(setEligibility)
      .catch((err) => {
        console.error("[product-detail] getProductEligibility:", err);
        setEligibility(null);
      });
  }, [isPartner, partnerProfile?.id, productId]);

  // ---- Load commission rules ----
  useEffect(() => {
    if (!saAgencyId) return;
    setRulesLoading(true);
    const unsub = subscribeToCommissionRules(
      saAgencyId,
      (rules) => {
        setCommissionRules(rules);
        setRulesLoading(false);
      },
      (err) => {
        console.error("[product-detail] subscribeToCommissionRules:", err);
        setRulesLoading(false);
      },
    );
    return () => unsub();
  }, [saAgencyId]);

  // ---- Derived ----
  const commissionRule = useMemo(() => {
    if (!product || rulesLoading) return undefined;
    return resolveCommissionRule(product.id, partnerProfile?.tier ?? null, commissionRules);
  }, [product, commissionRules, rulesLoading, partnerProfile?.tier]);

  const readiness = useMemo(() => {
    if (!product) return null;
    return resolveReadiness(product, isAdmin, isPartner, eligibility);
  }, [product, isAdmin, isPartner, eligibility]);

  const family = product?.productFamily ?? null;
  const familyLabel = family ? FAMILY_LABELS[family] : "Uncategorized";
  const familyStyle = family ? FAMILY_COLORS[family] : null;

  // ---- Checkout handler ----
  async function handleCheckout(billingInterval: "monthly" | "annual" = "monthly") {
    if (!product || !subAccountId || !user?.uid || !saAgencyId) return;
    setCheckoutLoading(true);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/marketplace/checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          subAccountId,
          billingInterval,
          // Phase 8: pass referral code so checkout route can resolve
          // partnerProfileId and stamp attribution metadata on the Stripe session.
          partnerReferralCode: partnerRefCode ?? null,
        }),
      });
      const data = await res.json() as {
        url?: string;
        error?: string;
        reason?: string;
        note?: string;
      };
      if (!res.ok) {
        setCheckoutError(data.error ?? data.reason ?? "Checkout failed.");
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      } else {
        setCheckoutError(data.note ?? "No checkout URL returned.");
      }
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setCheckoutLoading(false);
    }
  }

  // ---- Render: loading ----
  if (product === undefined || partnerLoading) {
    return (
      <div className="min-h-screen p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="h-6 w-32 animate-pulse rounded-md bg-muted/60" />
          <div className="h-48 animate-pulse rounded-xl border bg-muted/40" />
        </div>
      </div>
    );
  }

  // ---- Render: not found ----
  if (product === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-muted-foreground">Product not found.</p>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-xs text-primary underline underline-offset-2"
        >
          Go back
        </button>
      </div>
    );
  }

  const readinessConfig = readiness ? READINESS_CONFIG[readiness] : null;
  const ReadinessIcon = readinessConfig?.icon ?? CheckCircle2;
  const canCheckout =
    readiness === "eligible_to_sell" ||
    readiness === "eligible_to_purchase" ||
    readiness === "test_checkout_ready";

  const hasMonthly = !!product.stripePriceIdMonthly;
  const hasAnnual = !!product.stripePriceIdAnnual;

  return (
    <div className="min-h-screen space-y-6 p-6">
      {/* ---- Back link ---- */}
      <div>
        <Link
          href={`/sa/${subAccountId}/marketplace`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Marketplace
        </Link>
      </div>

      {/* ---- Header ---- */}
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="mb-1 flex items-center gap-2 text-muted-foreground">
            <ShoppingBag className="h-4 w-4" />
            <span className="text-sm font-medium uppercase tracking-wider">
              {familyLabel}
            </span>
            {familyStyle && (
              <span className={cn("h-1.5 w-1.5 rounded-full", familyStyle.dot)} />
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {product.name}
          </h1>
          {product.description && (
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-xl">
              {product.description}
            </p>
          )}
        </div>
      </div>

      {/* ---- Details grid ---- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Access model */}
        <DetailCard
          label="Access model"
          icon={
            product.accessModel === "subscription" ? RefreshCw
            : product.accessModel === "byok" ? Key
            : CreditCard
          }
          value={
            product.accessModel === "subscription" ? "Subscription"
            : product.accessModel === "byok" ? "Bring Your Own Key"
            : "Credit-Based"
          }
        />

        {/* Billing */}
        <DetailCard
          label="Billing"
          icon={Tag}
          value={getBillingDescription(product)}
        />

        {/* Commission */}
        <DetailCard
          label="Partner commission"
          icon={TrendingUp}
          value={
            commissionRule === undefined
              ? "Loading…"
              : commissionRule
                ? `${commissionRule.commissionPct}% — ${commissionRule.name}`
                : "No active commission rule"
          }
          valueClassName={commissionRule ? "text-emerald-700 dark:text-emerald-400" : undefined}
        />

        {/* Setup fee */}
        {product.setupFeeCents > 0 && (
          <DetailCard
            label="One-time setup fee"
            icon={CreditCard}
            value={`$${(product.setupFeeCents / 100).toFixed(2)}`}
          />
        )}

        {/* Certification */}
        <DetailCard
          label="Certification required"
          icon={Award}
          value={product.productFamily === "myusa_education" ? "Yes — complete the cert track" : "No"}
        />

        {/* BYOK */}
        {product.accessModel === "byok" && (
          <DetailCard
            label="API key"
            icon={ShieldCheck}
            value="Partner-supplied key required"
          />
        )}

        {/* Admin: status + visibility */}
        {isAdmin && (
          <>
            <DetailCard
              label="Product status"
              icon={Eye}
              value={product.status.charAt(0).toUpperCase() + product.status.slice(1)}
              valueClassName={
                product.status === "active" ? "text-green-700 dark:text-green-400"
                : product.status === "draft" ? "text-zinc-500"
                : "text-red-600"
              }
            />
            <DetailCard
              label="Visibility"
              icon={product.isPublic ? Eye : EyeOff}
              value={product.isPublic ? "Public (in marketplace)" : "Hidden"}
            />
            {product.stripePriceIdMonthly && (
              <DetailCard
                label="Stripe monthly price ID"
                icon={Tag}
                value={product.stripePriceIdMonthly}
                mono
              />
            )}
            {product.stripePriceIdAnnual && (
              <DetailCard
                label="Stripe annual price ID"
                icon={Tag}
                value={product.stripePriceIdAnnual}
                mono
              />
            )}
          </>
        )}
      </div>

      {/* ---- Eligibility status (partner only) ---- */}
      {isPartner && (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Your eligibility</h2>
          {eligibility === undefined ? (
            <div className="h-4 w-32 animate-pulse rounded bg-muted/60" />
          ) : eligibility ? (
            <div className="flex items-center gap-2">
              {eligibility.status === "approved" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : eligibility.status === "pending" ? (
                <Clock className="h-4 w-4 text-amber-500" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
              <span className="text-sm capitalize text-foreground">{eligibility.status}</span>
              {eligibility.reviewNote && (
                <span className="ml-2 text-xs text-muted-foreground">— {eligibility.reviewNote}</span>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No eligibility record found. Contact your account manager to apply.
            </p>
          )}
        </div>
      )}

      {/* ---- Checkout readiness + action ---- */}
      {readinessConfig && (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Checkout readiness</h2>

          <div className={cn("inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold mb-3", readinessConfig.className)}>
            <ReadinessIcon className="h-4 w-4" />
            {readinessConfig.label}
          </div>

          <p className="mb-4 text-xs text-muted-foreground leading-relaxed">
            {readinessConfig.description}
          </p>

          {checkoutError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/20 dark:text-red-400">
              {checkoutError}
            </div>
          )}

          {canCheckout && product.accessModel === "subscription" && (
            <div className="flex flex-wrap gap-2">
              {hasMonthly && (
                <button
                  type="button"
                  onClick={() => handleCheckout("monthly")}
                  disabled={checkoutLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {checkoutLoading ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  Monthly checkout{readiness === "test_checkout_ready" ? " (test)" : ""}
                </button>
              )}
              {hasAnnual && (
                <button
                  type="button"
                  onClick={() => handleCheckout("annual")}
                  disabled={checkoutLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary px-4 py-2 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
                >
                  {checkoutLoading ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  Annual checkout{readiness === "test_checkout_ready" ? " (test)" : ""}
                </button>
              )}
            </div>
          )}

          {canCheckout && product.accessModel !== "subscription" && (
            <p className="text-xs text-muted-foreground italic">
              Checkout for {product.accessModel === "credit" ? "credit-based" : "BYOK"} products is not yet available via the marketplace UI.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail card sub-component
// ---------------------------------------------------------------------------

interface DetailCardProps {
  label: string;
  icon: typeof CheckCircle2;
  value: string;
  valueClassName?: string;
  mono?: boolean;
}

function DetailCard({ label, icon: Icon, value, valueClassName, mono = false }: DetailCardProps) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 flex-shrink-0" />
        {label}
      </div>
      <p
        className={cn(
          "text-sm font-medium text-foreground",
          mono && "font-mono text-xs",
          valueClassName,
        )}
      >
        {value}
      </p>
    </div>
  );
}
