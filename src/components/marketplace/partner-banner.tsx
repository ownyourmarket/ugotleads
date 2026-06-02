"use client";

import { Award, MapPin, Sparkles, Star, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PartnerProfile, PartnerTrack } from "@/types/partner";

// ---------------------------------------------------------------------------
// Known seeder track IDs (deterministic slugs from revenue-os-seeder.ts)
// ---------------------------------------------------------------------------

const TRACK_AI_CONSULTANT = "track_certified_ai_consultant";
const TRACK_COMMUNITY_ADVOCATE = "track_community_advocate";

// ---------------------------------------------------------------------------
// Banner configurations
// ---------------------------------------------------------------------------

interface BannerConfig {
  icon: typeof Zap;
  title: string;
  message: string;
  className: string;
  iconClassName: string;
}

/**
 * Resolves the correct banner based on real partner profile + track data.
 *
 * Logic:
 *  - No profile / inactive → non-partner "Become certified" prompt
 *  - Active partner, completedTrackIds includes BOTH tracks → dual-unlock banner
 *  - Active partner, activeTrackId = AI Consultant → Certified AI Consultant banner
 *  - Active partner, activeTrackId = Community Advocate → Community Advocate banner
 *  - Active partner, no specific track → generic partner banner
 */
function resolveBanner(
  profile: PartnerProfile | null,
  track: PartnerTrack | null,
): BannerConfig {
  // No profile or inactive/suspended/terminated — show the "become a partner" prompt
  if (!profile || profile.status === "suspended" || profile.status === "terminated") {
    return {
      icon: Sparkles,
      title: "Join the MyUSA Local Partner Network",
      message:
        "Become certified to sell and operate MyUSA Local offers powered by uGotLeads.",
      className:
        "bg-zinc-50 border-zinc-200 dark:bg-zinc-900/40 dark:border-zinc-700",
      iconClassName: "text-zinc-500 dark:text-zinc-400",
    };
  }

  // completedTrackIds was added in revenue_os_v2; treat missing/undefined as [].
  const completedTrackIds: string[] = profile.completedTrackIds ?? [];
  const hasBothTracks =
    completedTrackIds.includes(TRACK_AI_CONSULTANT) &&
    completedTrackIds.includes(TRACK_COMMUNITY_ADVOCATE);

  if (hasBothTracks) {
    return {
      icon: Star,
      title: "Certified AI Consultant & Community Advocate",
      message:
        "You are unlocked as both a Certified AI Consultant and a Support Local Community Advocate. Full product access enabled.",
      className:
        "bg-gradient-to-r from-violet-50 to-emerald-50 border-violet-200 dark:from-violet-950/30 dark:to-emerald-950/30 dark:border-violet-800",
      iconClassName: "text-violet-600 dark:text-violet-400",
    };
  }

  const activeTrackId = profile.activeTrackId;

  if (activeTrackId === TRACK_AI_CONSULTANT) {
    return {
      icon: Award,
      title: track?.name ?? "Certified AI Consultant",
      message:
        "You can sell and operate AI, CRM, and growth products for clients.",
      className:
        "bg-violet-50 border-violet-200 dark:bg-violet-950/30 dark:border-violet-800",
      iconClassName: "text-violet-600 dark:text-violet-400",
    };
  }

  if (activeTrackId === TRACK_COMMUNITY_ADVOCATE) {
    return {
      icon: MapPin,
      title: track?.name ?? "Support Local Community Advocate",
      message:
        "You can refer local businesses into listings, spotlights, audits, and local growth offers.",
      className:
        "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800",
      iconClassName: "text-emerald-600 dark:text-emerald-400",
    };
  }

  // Generic active partner — no specific track set or unrecognised track
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PartnerBannerProps {
  /** Real partner profile from Firestore (null = not a partner). */
  profile: PartnerProfile | null;
  /** Active track doc (null when no track or not yet loaded). */
  track: PartnerTrack | null;
  /** Suppress the banner while partner data is loading. */
  loading?: boolean;
}

export function PartnerBanner({ profile, track, loading = false }: PartnerBannerProps) {
  if (loading) return null;

  const banner = resolveBanner(profile, track);
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
