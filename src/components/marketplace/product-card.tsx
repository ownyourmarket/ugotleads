"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Product, ProductFamily, AccessModel } from "@/types/products";
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
// Component
// ---------------------------------------------------------------------------

interface ProductCardProps {
  product: Product;
  /** Show admin-only fields (status, visibility). */
  isAdmin?: boolean;
}

export function ProductCard({ product, isAdmin = false }: ProductCardProps) {
  const family = product.productFamily ?? null;
  const familyLabel = family ? FAMILY_LABELS[family] : "Uncategorized";
  const familyStyle = family ? FAMILY_COLORS[family] : null;
  const statusStyle = STATUS_STYLES[product.status];
  const AccessIcon = ACCESS_ICONS[product.accessModel];

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

        {/* Commissionable — placeholder until partner commission linking is built */}
        {/* TODO: wire commissionable status from CommissionRule lookup */}
        <span
          className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          title="Commission eligible (placeholder — rule lookup not yet wired)"
        >
          <TrendingUp className="h-3 w-3" />
          {product.productFamily === "ugotleads_software" ||
          product.productFamily === "myusa_education"
            ? "Commissionable"
            : "Commission TBD"}
        </span>

        {/* Certification requirement placeholder */}
        {/* TODO: wire certification requirement from ProductEligibility or PartnerTrack */}
        {product.productFamily === "myusa_education" && (
          <span
            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            title="Certification linked (placeholder)"
          >
            <Award className="h-3 w-3" />
            Cert. track
          </span>
        )}

        {/* Security / compliance badge for byok */}
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
