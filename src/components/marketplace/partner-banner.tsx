"use client";

import { Award, MapPin, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Partner track identifiers (deterministic, matches seeder slug IDs)
// ---------------------------------------------------------------------------

// TODO: Replace these constants with real partner profile data once partner
// Firestore reads and PartnerProfile context are wired. See:
//   - src/types/partner.ts → PartnerProfile.activeTrackId
//   - src/lib/firestore/partners.ts (not yet built)
// Do NOT fake permissions here — use null-safe defaults.
export type KnownTrack =
  | "track_certified_ai_consultant"
  | "track_community_advocate"
  | null;

export interface PartnerBannerProps {
  /**
   * Whether the current user has an approved PartnerProfile in this agency.
   * TODO: derive from a usePartnerProfile() hook once partner reads are wired.
   * Default: false (safe — shows nothing rather than false permissions).
   */
  isPartner?: boolean;

  /**
   * The active (or most recently completed) partner track docId.
   * Null when the user has no track or partner data isn't loaded yet.
   * TODO: read from PartnerProfile.activeTrackId once partner reads are wired.
   */
  activeTrackId?: KnownTrack;

  /** Pass true while partner data is still loading to suppress the banner. */
  loading?: boolean;
}

interface BannerConfig {
  icon: typeof Zap;
  title: string;
  message: string;
  className: string;
  iconClassName: string;
}

function resolveBanner(
  isPartner: boolean,
  activeTrackId: KnownTrack,
): BannerConfig | null {
  if (!isPartner) return null;

  if (activeTrackId === "track_certified_ai_consultant") {
    return {
      icon: Award,
      title: "Certified AI Consultant",
      message:
        "You can sell and operate AI, CRM, and growth products for clients.",
      className:
        "bg-violet-50 border-violet-200 dark:bg-violet-950/30 dark:border-violet-800",
      iconClassName: "text-violet-600 dark:text-violet-400",
    };
  }

  if (activeTrackId === "track_community_advocate") {
    return {
      icon: MapPin,
      title: "Support Local Community Advocate",
      message:
        "You can refer local businesses into listings, spotlights, audits, and local growth offers.",
      className:
        "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800",
      iconClassName: "text-emerald-600 dark:text-emerald-400",
    };
  }

  // Generic partner (no specific track identified)
  return {
    icon: Zap,
    title: "MyUSA Local Partner",
    message:
      "You can sell eligible products through your MyUSA Local partner account.",
    className:
      "bg-sky-50 border-sky-200 dark:bg-sky-950/30 dark:border-sky-800",
    iconClassName: "text-sky-600 dark:text-sky-400",
  };
}

export function PartnerBanner({
  isPartner = false,
  activeTrackId = null,
  loading = false,
}: PartnerBannerProps) {
  if (loading || !isPartner) return null;

  const banner = resolveBanner(isPartner, activeTrackId);
  if (!banner) return null;

  const Icon = banner.icon;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4",
        banner.className,
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/70 dark:bg-black/20",
          banner.iconClassName,
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-sm font-semibold text-foreground">{banner.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{banner.message}</p>
      </div>
    </div>
  );
}
