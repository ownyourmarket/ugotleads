"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Award,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  Lock,
  ShoppingBag,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { usePartnerProfile } from "@/hooks/use-partner-profile";
import { subscribeToPartnerTracks, subscribeToCertifications } from "@/lib/firestore/partners";
import { subscribeToPartnerTrackProgress } from "@/lib/firestore/training";
import { DEFAULT_TRACK_MODULES, DEFAULT_TRACK_META } from "@/lib/training/content";
import type { PartnerTrack, Certification } from "@/types/partner";
import type { TrackProgress, TrackProgressStatus } from "@/types/training";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Track status helpers
// ---------------------------------------------------------------------------

function progressStatus(progress: TrackProgress | undefined): TrackProgressStatus | "not_started" {
  if (!progress) return "not_started";
  return progress.status;
}

function statusConfig(status: TrackProgressStatus | "not_started"): {
  label: string;
  icon: typeof Clock;
  className: string;
} {
  switch (status) {
    case "not_started":
      return { label: "Not started", icon: BookOpen, className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" };
    case "in_progress":
      return { label: "In progress", icon: Clock, className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" };
    case "completed":
      return { label: "Awaiting review", icon: Clock, className: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" };
    case "approved":
      return { label: "Certified ✓", icon: BadgeCheck, className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" };
    case "revoked":
      return { label: "Revoked", icon: Lock, className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" };
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TrainingDashboardPage() {
  const { user } = useAuth();
  const { subAccountId } = useSubAccount();
  const { profile: partnerProfile, loading: partnerLoading } = usePartnerProfile(user?.uid);

  const [tracks, setTracks] = useState<PartnerTrack[]>([]);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [progress, setProgress] = useState<TrackProgress[]>([]);
  const [tracksLoading, setTracksLoading] = useState(true);

  // The agencyId may come from partner profile or from the sub-account context
  const { agencyId: saAgencyId } = useSubAccount();

  useEffect(() => {
    if (!saAgencyId) return;
    setTracksLoading(true);
    let done = 0;
    const check = () => { if (++done === 2) setTracksLoading(false); };

    const u1 = subscribeToPartnerTracks(saAgencyId, (d) => { setTracks(d); check(); }, () => check());
    const u2 = subscribeToCertifications(saAgencyId, (d) => { setCertifications(d); check(); }, () => check());
    return () => { u1(); u2(); };
  }, [saAgencyId]);

  useEffect(() => {
    if (!partnerProfile?.id) { setProgress([]); return; }
    const unsub = subscribeToPartnerTrackProgress(partnerProfile.id, setProgress, console.error);
    return () => unsub();
  }, [partnerProfile?.id]);

  const progressMap = useMemo(
    () => new Map(progress.map((p) => [p.trackId, p])),
    [progress],
  );

  const certMap = useMemo(
    () => new Map(certifications.map((c) => [c.trackId, c])),
    [certifications],
  );

  // Merge Firestore tracks with hardcoded fallbacks for the two canonical tracks
  const displayTracks = useMemo(() => {
    const knownIds = Object.keys(DEFAULT_TRACK_META);
    // Start with Firestore tracks
    const firestoreIds = new Set(tracks.filter((t) => t.status === "active").map((t) => t.id));
    // Add canonical tracks even if not in Firestore (uses defaults)
    const allIds = [...new Set([...firestoreIds, ...knownIds])];
    return allIds.map((id) => {
      const ft = tracks.find((t) => t.id === id);
      const meta = DEFAULT_TRACK_META[id];
      return {
        id,
        name: ft?.name ?? meta?.name ?? id,
        description: ft?.description ?? meta?.description ?? "",
        milestones: ft?.milestones ?? [],
        certificationId: ft?.certificationId ?? null,
        unlocksDescription: meta?.unlocksDescription ?? "Products and permissions tied to this track",
        moduleCount: (ft?.milestones?.length ?? 0) > 0
          ? ft!.milestones.length
          : (DEFAULT_TRACK_MODULES[id]?.length ?? 0),
      };
    });
  }, [tracks]);

  const isPartner = !!partnerProfile && (partnerProfile.status === "active" || partnerProfile.status === "approved");
  const loading = partnerLoading || tracksLoading;

  const completedCount = progress.filter((p) => p.status === "approved").length;

  return (
    <div className="min-h-screen space-y-8 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-muted-foreground">
            <BookOpen className="h-4 w-4" />
            <span className="text-sm font-medium uppercase tracking-wider">Revenue OS</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Training &amp; Certifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete certification tracks to unlock products and earn commission eligibility.
          </p>
        </div>
        <Link
          href={`/sa/${subAccountId}/marketplace/partner`}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ShoppingBag className="h-3.5 w-3.5" />
          Partner Profile
        </Link>
      </div>

      {/* Partner status warning */}
      {!loading && !isPartner && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-sm text-amber-700 dark:text-amber-300">
            <strong>Partner enrollment required.</strong> You need an active partner profile to
            enroll in certification tracks. Contact your agency owner to get started.
          </p>
        </div>
      )}

      {/* Stats row */}
      {isPartner && !loading && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Available tracks</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{displayTracks.length}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Certified</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{completedCount}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">In progress</p>
            <p className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {progress.filter((p) => p.status === "in_progress" || p.status === "completed").length}
            </p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      )}

      {/* Track cards */}
      {!loading && (
        <div className="grid gap-5 sm:grid-cols-2">
          {displayTracks.map((track) => {
            const prog = progressMap.get(track.id);
            const status = progressStatus(prog);
            const config = statusConfig(status);
            const StatusIcon = config.icon;
            const cert = certMap.get(track.id);
            const pct = prog && prog.totalModules > 0
              ? Math.round((prog.completedModuleIndices.length / prog.totalModules) * 100)
              : 0;

            return (
              <div
                key={track.id}
                className={cn(
                  "rounded-xl border bg-card p-5 transition-shadow hover:shadow-md",
                  !isPartner && "opacity-60",
                )}
              >
                {/* Track header */}
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1.5 flex items-center gap-2">
                      {status === "approved" ? (
                        <BadgeCheck className="h-5 w-5 flex-shrink-0 text-emerald-500" />
                      ) : (
                        <Award className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                      )}
                      <h3 className="text-sm font-semibold text-foreground">{track.name}</h3>
                    </div>
                    <span className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      config.className,
                    )}>
                      <StatusIcon className="h-2.5 w-2.5" />
                      {config.label}
                    </span>
                  </div>
                  {cert?.badgeUrl && status === "approved" && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cert.badgeUrl} alt={cert.name} className="h-12 w-12 flex-shrink-0 rounded-lg object-contain" />
                  )}
                </div>

                {/* Description */}
                <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{track.description}</p>

                {/* Progress bar (only when in progress) */}
                {(status === "in_progress") && (
                  <div className="mb-3">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{prog!.completedModuleIndices.length}/{prog!.totalModules} modules</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/70 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Modules count */}
                <p className="mb-4 text-[11px] text-muted-foreground">
                  {track.moduleCount} module{track.moduleCount !== 1 ? "s" : ""}
                </p>

                {/* Unlocks */}
                <div className="mb-4 flex items-start gap-1.5 rounded-lg bg-muted/40 px-3 py-2">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
                  <p className="text-[11px] text-muted-foreground">
                    <strong>Unlocks:</strong> {track.unlocksDescription}
                  </p>
                </div>

                {/* CTA */}
                {isPartner ? (
                  <Link
                    href={`/sa/${subAccountId}/training/${track.id}`}
                    className={cn(
                      "inline-flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-colors",
                      status === "approved"
                        ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300"
                        : "bg-primary text-primary-foreground hover:bg-primary/90",
                    )}
                  >
                    {status === "not_started" ? (
                      <>Start track <ChevronRight className="h-3.5 w-3.5" /></>
                    ) : status === "completed" ? (
                      <>Review progress <ChevronRight className="h-3.5 w-3.5" /></>
                    ) : status === "approved" ? (
                      <>View certification <ChevronRight className="h-3.5 w-3.5" /></>
                    ) : (
                      <>Continue <ChevronRight className="h-3.5 w-3.5" /></>
                    )}
                  </Link>
                ) : (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-2 text-xs text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" />
                    Partner enrollment required
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
