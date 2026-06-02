"use client";

import { cn } from "@/lib/utils";
import type { Product, ProductFamily, AccessModel, ProductEligibility } from "@/types/products";
import type { CommissionRule } from "@/types/credits";
import type { PartnerProfile } from "@/types/partner";
import {
  Award,
  CreditCard,
  Eye,
  EyeOff,
  Key,
  RefreshCw,
  ShieldCheck,
  Tag,
  TrendingUp,
  Clock,
  CheckCircle2,
  XCircle,
  Info,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export const FAMILY_LABELS: Record<ProductFamily, string> = {
  ugotleads_software: "uGotLeads Software",
  myusa_education: "MyUSA Education",
  myusa_services: "MyUSA Services",
  myusa_resources: "MyUSA Resources",
  myusa_media_products: "MyUSA Media & Directory",
};

export const FAMILY_COLORS: Record<
  ProductFamily,
  { badge: string; dot: string }
> = {
  ugotleads_software: {
    badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    dot: "bg-violet-500",
  },
  myusa_education: {
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  myusa_services: {
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  myusa_resources: {
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  myusa_media_products: {
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
    dot: "bg-rose-500",
  },
};

const ACCESS_LABELS: Record<AccessModel, string> = {
  credit: "Credit-Based",
  subscription: "Subscription",
  byok: "BYOK",
};

const ACCESS_ICONS: Record<AccessModel, typeof CreditCard> = {
  credit: CreditCard,
  subscription: RefreshCw,
  byok: Key,
};

const STATUS_STYLES: Record<
  Product["status"],
  { label: string; className: string }
> = {
  active: {
    label: "Active",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  },
  draft: {
    label: "Draft",
    className:
      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  },
  archived: {
    label: "Archived",
    className:
      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  },
};

function getPriceLabel(product: Product): string {
  if (product.accessModel === "credit") {
    return product.creditCostPerUnit > 0
      ? `${product.creditCostPerUnit} credit${product.creditCostPerUnit === 1 ? "" : "s"}`
      : "Free (credits)";
  }
  if (product.accessModel === "subscription") {
    if (product.stripePriceIdMonthly || product.stripePriceIdAnnual) {
      return "Monthly / Annual";
    }
    return "Pricing TBD";
  }
  if (product.accessModel === "byok") {
    return "Bring Your Own Key";
  }
  return "—";
}

// ---------------------------------------------------------------------------
// Commission helpers
// ---------------------------------------------------------------------------

/**
 * Returns the best matching active commission rule for a product + partner tier.
 * Preference order:
 *   1. Product-specific rule matching the partner's tier
 *   2. Product-specific rule applying to all tiers (partnerTier === null)
 *   3. Global rule matching the partner's tier
 *   4. Global rule applying to all tiers
 * Returns null when no active rule matches.
 */
export function resolveCommissionRule(
  productId: string,
  partnerTier: PartnerProfile["tier"] | null,
  allRules: CommissionRule[],
): CommissionRule | null {
  const active = allRules.filter((r) => r.isActive);

  const candidates = [
    // Product-specific + tier-specific
    active.find((r) => r.productId === productId && r.partnerTier === partnerTier),
    // Product-specific + all tiers
    active.find((r) => r.productId === productId && r.partnerTier === null),
    // Global (all products) + tier-specific
    active.find((r) => r.productId === null && r.partnerTier === partnerTier),
    // Global + all tiers
    active.find((r) => r.productId === null && r.partnerTier === null),
  ];

  return candidates.find(Boolean) ?? null;
}

// ---------------------------------------------------------------------------
// Action button logic
// ---------------------------------------------------------------------------

type ActionVariant =
  | "view_details"
  | "coming_soon"
  | "requires_certification"
  | "eligible_to_sell"
  | "eligibility_pending";

interface ActionConfig {
  label: string;
  variant: ActionVariant;
  className: string;
}

function resolveAction(
  product: Product,
  isPartner: boolean,
  eligibility: ProductEligibility | null,
): ActionConfig {
  // Draft or hidden → always "Coming soon"
  if (product.status !== "active" || !product.isPublic) {
    return {
      label: "Coming soon",
      variant: "coming_soon",
      className:
        "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 cursor-not-allowed",
    };
  }

  // Education products require certification to operate (not just to view)
  const requiresCert = product.productFamily === "myusa_education";

  if (!isPartner) {
    // Non-partners can view details but cannot sell
    return {
      label: "View details",
      variant: "view_details",
      className:
        "border border-border text-foreground hover:bg-muted/60 transition-colors",
    };
  }

  // Partner: check eligibility doc
  if (eligibility) {
    if (eligibility.status === "approved") {
      return {
        label: "Eligible to sell",
        variant: "eligible_to_sell",
        className:
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
      };
    }
    if (eligibility.status === "pending") {
      return {
        label: "Eligibility pending",
        variant: "eligibility_pending",
        className:
          "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
      };
    }
    // denied or revoked
    return {
      label: "Not eligible",
      variant: "coming_soon",
      className:
        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 cursor-not-allowed",
    };
  }

  // Partner, no eligibility doc yet
  if (requiresCert) {
    return {
      label: "Requires certification",
      variant: "requires_certification",
      className:
        "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    };
  }

  return {
    label: "Eligible to sell",
    variant: "eligible_to_sell",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ProductCardProps {
  product: Product;
  /** Show admin-only fields (status, visibility). */
  isAdmin?: boolean;
  /** True when the current user has an active PartnerProfile. */
  isPartner?: boolean;
  /**
   * Eligibility doc for this partner + product pair.
   * Null = no doc exists yet (not applied or not yet seeded).
   * Undefined = eligibility data not loaded yet (loading state).
   */
  eligibility?: ProductEligibility | null;
  /**
   * The best matching CommissionRule for this product.
   * Null = no rule matches.
   * Undefined = rules not loaded yet.
   */
  commissionRule?: CommissionRule | null;
}

export function ProductCard({
  product,
  isAdmin = false,
  isPartner = false,
  eligibility,
  commissionRule,
}: ProductCardProps) {
  const family = product.productFamily ?? null;
  const familyLabel = family ? FAMILY_LABELS[family] : "Uncategorized";
  const familyStyle = family ? FAMILY_COLORS[family] : null;
  const statusStyle = STATUS_STYLES[product.status];
  const AccessIcon = ACCESS_ICONS[product.accessModel];

  const action = resolveAction(product, isPartner, eligibility ?? null);
  const rulesLoaded = commissionRule !== undefined;
  const hasRule = rulesLoaded && commissionRule !== null;

  // Certification requirement: real eligibility doc takes precedence over family heuristic
  const certRequired =
    eligibility?.status === "denied"
      ? false
      : product.productFamily === "myusa_education";
  const certSource: "rule" | "default_guidance" | null = certRequired
    ? eligibility !== undefined
      ? "rule"       // eligibility doc exists → based on real data
      : "default_guidance" // no eligibility data yet → fallback label
    : null;

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-xl border bg-card p-5 shadow-sm transition-all duration-200",
        "hover:shadow-md hover:border-primary/30",
        product.status === "draft" && "opacity-75",
      )}
    >
      {/* Family dot + name */}
      <div className="mb-3 flex items-center gap-2">
        {familyStyle && (
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full flex-shrink-0",
              familyStyle.dot,
            )}
          />
        )}
        <span className="text-xs text-muted-foreground truncate">
          {familyLabel}
        </span>
      </div>

      {/* Product name */}
      <h3 className="mb-1 text-sm font-semibold leading-snug text-foreground">
        {product.name}
      </h3>

      {/* Description */}
      {product.description && (
        <p className="mb-3 text-xs text-muted-foreground line-clamp-2">
          {product.description}
        </p>
      )}

      {/* Core badges row */}
      <div className="mt-auto flex flex-wrap gap-1.5">
        {/* Access model */}
        <span
          className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          title="Access model"
        >
          <AccessIcon className="h-3 w-3" />
          {ACCESS_LABELS[product.accessModel]}
        </span>

        {/* Price / billing */}
        <span
          className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          title="Pricing"
        >
          <Tag className="h-3 w-3" />
          {getPriceLabel(product)}
        </span>

        {/* Commission — real rule or loading state */}
        {!rulesLoaded ? (
          <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground/50">
            <TrendingUp className="h-3 w-3" />
            Commission…
          </span>
        ) : hasRule ? (
          <span
            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30"
            title={commissionRule!.name}
          >
            <TrendingUp className="h-3 w-3" />
            {commissionRule!.commissionPct}% commission
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            title="No active commission rule found for this product"
          >
            <TrendingUp className="h-3 w-3" />
            No commission rule
          </span>
        )}

        {/* Certification requirement — real or default guidance */}
        {certRequired && certSource && (
          <span
            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            title={
              certSource === "default_guidance"
                ? "Default guidance — no eligibility doc yet"
                : "Based on product eligibility"
            }
          >
            <Award className="h-3 w-3" />
            Cert. track
            {certSource === "default_guidance" && (
              <Info className="h-2.5 w-2.5 opacity-60" />
            )}
          </span>
        )}

        {/* Security badge for BYOK */}
        {product.accessModel === "byok" && (
          <span
            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            title="Requires partner's own API key"
          >
            <ShieldCheck className="h-3 w-3" />
            Key required
          </span>
        )}
      </div>

      {/* Action button */}
      <div className="mt-4">
        <button
          type="button"
          disabled={
            action.variant === "coming_soon" ||
            action.variant === "eligibility_pending"
          }
          className={cn(
            "w-full rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
            action.className,
          )}
        >
          <span className="flex items-center justify-center gap-1.5">
            {action.variant === "eligible_to_sell" && (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            {action.variant === "eligibility_pending" && (
              <Clock className="h-3.5 w-3.5" />
            )}
            {(action.variant === "coming_soon") && (
              <XCircle className="h-3.5 w-3.5" />
            )}
            {action.label}
          </span>
        </button>
      </div>

      {/* Admin-only section: status + visibility */}
      {isAdmin && (
        <div className="mt-3 flex items-center gap-2 border-t pt-3">
          {/* Status */}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              statusStyle.className,
            )}
          >
            {statusStyle.label}
          </span>

          {/* Visibility */}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              product.isPublic
                ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
            )}
            title={product.isPublic ? "Visible in marketplace" : "Hidden from marketplace"}
          >
            {product.isPublic ? (
              <Eye className="h-2.5 w-2.5" />
            ) : (
              <EyeOff className="h-2.5 w-2.5" />
            )}
            {product.isPublic ? "Public" : "Hidden"}
          </span>
        </div>
      )}
    </div>
  );
}
