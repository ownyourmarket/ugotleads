"use client";

import { useState } from "react";
import { CheckCircle2, CreditCard, Key, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AccessModel } from "@/types/products";
import type { PartnerProfile } from "@/types/partner";

// ---------------------------------------------------------------------------
// Track IDs — deterministic slugs from revenue-os-seeder.ts
// ---------------------------------------------------------------------------

const TRACK_AI_CONSULTANT = "track_certified_ai_consultant";
const TRACK_COMMUNITY_ADVOCATE = "track_community_advocate";

// ---------------------------------------------------------------------------
// Access path definitions (source-of-truth copy from spec)
// ---------------------------------------------------------------------------

interface BenefitBullet {
  text: string;
}

interface AccessPath {
  model: AccessModel;
  label: string;        // spec heading label
  tagline: string;      // sub-label
  bestFor: string;
  benefits: BenefitBullet[];
  icon: typeof CreditCard;
  highlight?: boolean;
}

const ACCESS_PATHS: AccessPath[] = [
  {
    model: "credit",
    label: "Start Free, Pay As You Use",
    tagline: "Credit-Based",
    bestFor: "Advocates, beginners, small agencies, local business owners",
    benefits: [
      { text: "Free account" },
      { text: "Buy credits as needed" },
      { text: "Use credits for leads, audits, enrichments, AI reports, and campaigns" },
    ],
    icon: CreditCard,
  },
  {
    model: "subscription",
    label: "Predictable Growth Plan",
    tagline: "Monthly / Yearly Subscription",
    bestFor: "Certified consultants, agencies, active business owners",
    benefits: [
      { text: "Included monthly credits" },
      { text: "CRM pipeline" },
      { text: "Client workspaces" },
      { text: "AI follow-up" },
      { text: "AEO / local visibility tools" },
      { text: "Priority features" },
    ],
    icon: RefreshCw,
    highlight: true,
  },
  {
    model: "byok",
    label: "Bring Your Own AI Key",
    tagline: "BYOK",
    bestFor: "Advanced certified consultants and agencies",
    benefits: [
      { text: "Use your own API key" },
      { text: "Lower AI usage cost" },
      { text: "Run higher volume" },
      { text: "Advanced control" },
    ],
    icon: Key,
  },
];

// ---------------------------------------------------------------------------
// Partner-aware messaging — one line shown inside or below the selected card
// ---------------------------------------------------------------------------

function resolvePartnerMessage(
  model: AccessModel,
  profile: PartnerProfile | null,
): string | null {
  if (!profile || (profile.status !== "active" && profile.status !== "approved")) {
    return null;
  }

  const completed: string[] = profile.completedTrackIds ?? [];
  const hasBoth =
    completed.includes(TRACK_AI_CONSULTANT) &&
    completed.includes(TRACK_COMMUNITY_ADVOCATE);
  const isConsultant = completed.includes(TRACK_AI_CONSULTANT);
  const isAdvocate = completed.includes(TRACK_COMMUNITY_ADVOCATE);

  if (hasBoth) {
    return "You are unlocked as both a local advocate and AI consultant.";
  }
  if (isConsultant) {
    return "You can sell and operate this product for clients.";
  }
  if (isAdvocate) {
    return "You can refer businesses into this offer and earn when eligible.";
  }

  // Active partner but no completed tracks yet
  if (model === "subscription" || model === "byok") {
    return "Complete a certification track to unlock full sell permissions.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AccessModelSelectorProps {
  /** Currently persisted planMode (from SubAccountDoc or null). */
  selected?: AccessModel | null;
  /** Sub-account ID — required for the persistence API call. */
  subAccountId?: string;
  /** Callback fired after a successful save with the new value. */
  onSaved?: (model: AccessModel) => void;
  /** Read-only display — no selection or API calls. */
  readOnly?: boolean;
  /** Partner profile for partner-aware messaging. */
  partnerProfile?: PartnerProfile | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AccessModelSelector({
  selected,
  subAccountId,
  onSaved,
  readOnly = false,
  partnerProfile = null,
}: AccessModelSelectorProps) {
  const [saving, setSaving] = useState<AccessModel | null>(null);
  const [savedModel, setSavedModel] = useState<AccessModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(model: AccessModel) {
    if (readOnly || saving) return;
    if (model === selected) return; // no-op if already active

    if (!subAccountId) {
      // No sub-account ID wired — update locally only (used in read-only contexts)
      onSaved?.(model);
      return;
    }

    setSaving(model);
    setError(null);
    setSavedModel(null);

    try {
      const res = await fetch(`/api/sub-accounts/${subAccountId}/plan-mode`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planMode: model }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }

      setSavedModel(model);
      onSaved?.(model);

      // Clear the ✓ indicator after 2 s
      setTimeout(() => setSavedModel(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed. Try again.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Choose your access path
        </p>
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {ACCESS_PATHS.map((path) => {
          const isSelected = selected === path.model;
          const isSaving = saving === path.model;
          const justSaved = savedModel === path.model;
          const Icon = path.icon;
          const partnerMsg = isSelected
            ? resolvePartnerMessage(path.model, partnerProfile)
            : null;

          return (
            <button
              key={path.model}
              type="button"
              disabled={readOnly || !!saving}
              onClick={() => handleSelect(path.model)}
              className={cn(
                "group relative flex flex-col rounded-xl border p-4 text-left transition-all duration-200",
                readOnly || saving ? "cursor-default" : "cursor-pointer",
                isSelected
                  ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30"
                  : path.highlight
                    ? "border-primary/40 bg-card hover:border-primary/70 hover:shadow-sm"
                    : "border-border bg-card hover:border-primary/40 hover:shadow-sm",
                saving && saving !== path.model && "opacity-50",
              )}
            >
              {/* Most popular badge */}
              {path.highlight && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground shadow-sm">
                  Most popular
                </span>
              )}

              {/* Header row */}
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg",
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </span>
                  <div>
                    <p className="text-sm font-semibold leading-tight text-foreground">
                      {path.label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {path.tagline}
                    </p>
                  </div>
                </div>

                {/* Saved checkmark */}
                {justSaved && (
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-500" />
                )}
              </div>

              {/* Best for */}
              <p className="mb-2.5 text-[11px] font-medium text-muted-foreground">
                Best for: {path.bestFor}
              </p>

              {/* Benefits */}
              <ul className="space-y-1">
                {path.benefits.map((b) => (
                  <li
                    key={b.text}
                    className="flex items-start gap-1.5 text-xs text-muted-foreground"
                  >
                    <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary/50" />
                    {b.text}
                  </li>
                ))}
              </ul>

              {/* Partner-aware message — only on selected card */}
              {partnerMsg && (
                <p className="mt-3 rounded-md bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary">
                  {partnerMsg}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
