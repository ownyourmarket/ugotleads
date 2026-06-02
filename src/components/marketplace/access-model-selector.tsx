"use client";

import { CreditCard, Key, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AccessModel } from "@/types/products";

interface AccessPath {
  model: AccessModel;
  title: string;
  tagline: string;
  description: string;
  icon: typeof CreditCard;
  highlight?: boolean;
}

const ACCESS_PATHS: AccessPath[] = [
  {
    model: "credit",
    title: "Credit-Based",
    tagline: "Pay as you go",
    description:
      "Purchase credit packs and spend them on individual products and features. No subscription required — perfect for exploring the platform.",
    icon: CreditCard,
  },
  {
    model: "subscription",
    title: "Monthly / Annual",
    tagline: "Unlimited access",
    description:
      "Subscribe to unlock full platform access including AI tools, CRM features, and Revenue OS capabilities. Annual pricing saves up to 20%.",
    icon: RefreshCw,
    highlight: true,
  },
  {
    model: "byok",
    title: "BYOK",
    tagline: "Bring Your Own Key",
    description:
      "Use your own API keys for AI models and integrations. Maximum control, no per-call markup. Best for technical operators running high volumes.",
    icon: Key,
  },
];

interface AccessModelSelectorProps {
  selected?: AccessModel | null;
  onSelect?: (model: AccessModel) => void;
  /** Read-only display — no selection interaction. */
  readOnly?: boolean;
}

export function AccessModelSelector({
  selected,
  onSelect,
  readOnly = false,
}: AccessModelSelectorProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Choose your access path
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {ACCESS_PATHS.map((path) => {
          const isSelected = selected === path.model;
          const Icon = path.icon;

          return (
            <button
              key={path.model}
              type="button"
              disabled={readOnly}
              onClick={() => !readOnly && onSelect?.(path.model)}
              className={cn(
                "group relative flex flex-col rounded-xl border p-4 text-left transition-all duration-200",
                readOnly ? "cursor-default" : "cursor-pointer",
                isSelected
                  ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30"
                  : path.highlight
                    ? "border-primary/40 bg-card hover:border-primary/70 hover:shadow-sm"
                    : "border-border bg-card hover:border-primary/40 hover:shadow-sm",
              )}
            >
              {path.highlight && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground shadow-sm">
                  Most popular
                </span>
              )}

              <div className="mb-3 flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold leading-none text-foreground">
                    {path.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {path.tagline}
                  </p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                {path.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
