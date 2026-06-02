"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Award,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  Clock,
  Square,
} from "lucide-react";
import { serverTimestamp } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { usePartnerProfile } from "@/hooks/use-partner-profile";
import { subscribeToPartnerTracks, subscribeToCertifications } from "@/lib/firestore/partners";
import {
  subscribeToPartnerTrackProgress,
  upsertTrackProgress,
  updateTrackProgress,
  submitTrackForReview,
  trackProgressDocId,
} from "@/lib/firestore/training";
import { DEFAULT_TRACK_MODULES, DEFAULT_TRACK_META } from "../page";
import type { PartnerTrack, Certification } from "@/types/partner";
import type { TrackProgress } from "@/types/training";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TrackDetailPage() {
  const params = useParams<{ subAccountId: string; trackId: string }>();
  const trackId = params?.trackId ?? "";
  const { subAccountId } = useSubAccount();
  const { user } = useAuth();
  const { profile: partnerProfile, loading: partnerLoading } = usePartnerProfile(user?.uid);

  const { agencyId: saAgencyId } = useSubAccount();

  const [tracks, setTracks] = useState<PartnerTrack[]>([]);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [allProgress, setAllProgress] = useState<TrackProgress[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!saAgencyId) return;
    const u1 = subscribeToPartnerTracks(saAgencyId, setTracks, console.error);
    const u2 = subscribeToCertifications(saAgencyId, setCertifications, console.error);
    return () => { u1(); u2(); };
  }, [saAgencyId]);

  useEffect(() => {
    if (!partnerProfile?.id) return;
    const unsub = subscribeToPartnerTrackProgress(partnerProfile.id, setAllProgress, console.error);
    return () => unsub();
  }, [partnerProfile?.id]);

  const progress = useMemo(
    () => allProgress.find((p) => p.trackId === trackId) ?? null,
    [allProgress, trackId],
  );

  // Resolve track content: Firestore first, then hardcoded defaults
  const firestoreTrack = tracks.find((t) => t.id === trackId);
  const meta = DEFAULT_TRACK_META[trackId];
  const track = {
    id: trackId,
    name: firestoreTrack?.name ?? meta?.name ?? trackId,
    description: firestoreTrack?.description ?? meta?.description ?? "",
    certificationId: firestoreTrack?.certificationId ?? null,
    unlocksDescription: meta?.unlocksDescription ?? "Products and permissions tied to this track",
  };

  // Resolve modules: Firestore milestones → converted to module list; else default
  const modules: Array<{ title: string; description: string }> = useMemo(() => {
    if (firestoreTrack?.milestones && firestoreTrack.milestones.length > 0) {
      return firestoreTrack.milestones.map((m) => ({ title: m, description: "" }));
    }
    return DEFAULT_TRACK_MODULES[trackId] ?? [];
  }, [firestoreTrack, trackId]);

  const cert = certifications.find((c) => c.trackId === trackId);

  // Checked module indices (local copy for optimistic UI + save queue)
  const checkedIndices = useMemo(
    () => new Set(progress?.completedModuleIndices ?? []),
    [progress],
  );
  const allChecked = modules.length > 0 && checkedIndices.size === modules.length;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  const isPartner = !!partnerProfile &&
    (partnerProfile.status === "active" || partnerProfile.status === "approved");

  // ---- Module toggle ----
  async function handleToggleModule(idx: number) {
    if (!isPartner || !partnerProfile || !saAgencyId) return;
    if (progress?.status === "completed" || progress?.status === "approved") return;

    setSaving(true);
    try {
      const current = progress?.completedModuleIndices ?? [];
      const next = current.includes(idx)
        ? current.filter((i) => i !== idx)
        : [...current, idx];

      const docId = trackProgressDocId(partnerProfile.id, trackId);
      const newStatus = next.length > 0 ? "in_progress" : "in_progress";

      if (!progress) {
        // First interaction — create the doc
        await upsertTrackProgress({
          agencyId: saAgencyId,
          partnerProfileId: partnerProfile.id,
          uid: user?.uid ?? "",
          trackId,
          certificationId: track.certificationId,
          completedModuleIndices: next,
          totalModules: modules.length,
          status: "in_progress",
          completedAt: null,
          approvedAt: null,
          approvedByUid: null,
          revokedAt: null,
          revokedByUid: null,
        });
      } else {
        await updateTrackProgress(docId, {
          completedModuleIndices: next,
          totalModules: modules.length,
          status: newStatus as "in_progress",
        });
      }
    } finally {
      setSaving(false);
    }
  }

  // ---- Submit for review ----
  async function handleSubmit() {
    if (!progress || !allChecked) return;
    setSaving(true);
    try {
      await submitTrackForReview(progress.id);
      showToast("Submitted for review. Your agency owner will be notified.");
    } finally {
      setSaving(false);
    }
  }

  const pct = modules.length > 0 ? Math.round((checkedIndices.size / modules.length) * 100) : 0;
  const loading = partnerLoading;

  if (loading) {
    return (
      <div className="min-h-screen p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="h-6 w-32 animate-pulse rounded bg-muted/60" />
          <div className="h-48 animate-pulse rounded-xl border bg-muted/40" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-6 p-6">
      <div className="mx-auto max-w-2xl">
        {/* Back */}
        <Link
          href={`/sa/${subAccountId}/training`}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Training
        </Link>

        {/* Track header */}
        <div className="mb-6 rounded-xl border bg-card p-6">
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-muted-foreground" />
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Certification Track
                </span>
              </div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">{track.name}</h1>
              {track.description && (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{track.description}</p>
              )}
            </div>
            {cert?.badgeUrl && progress?.status === "approved" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cert.badgeUrl} alt={cert.name} className="h-16 w-16 flex-shrink-0 rounded-xl object-contain" />
            )}
          </div>

          {/* Certified state */}
          {progress?.status === "approved" && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 dark:bg-emerald-900/20">
              <BadgeCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Certified!</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  This track has been completed and approved.
                </p>
              </div>
            </div>
          )}

          {/* Awaiting review */}
          {progress?.status === "completed" && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-sky-50 px-4 py-3 dark:bg-sky-900/20">
              <Clock className="h-5 w-5 text-sky-600 dark:text-sky-400" />
              <div>
                <p className="text-sm font-semibold text-sky-700 dark:text-sky-300">Awaiting review</p>
                <p className="text-xs text-sky-600 dark:text-sky-400">
                  All modules complete. Your agency owner will review and approve your certification.
                </p>
              </div>
            </div>
          )}

          {/* Progress bar */}
          {progress && progress.status !== "approved" && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                <span>{checkedIndices.size} of {modules.length} modules complete</span>
                <span className="font-medium">{pct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    pct === 100 ? "bg-emerald-500" : "bg-primary/70",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Modules */}
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Modules
          </h2>
          {!isPartner ? (
            <div className="rounded-xl border border-dashed py-10 text-center">
              <p className="text-sm text-muted-foreground">
                Partner enrollment required to start this track.
              </p>
            </div>
          ) : modules.length === 0 ? (
            <div className="rounded-xl border border-dashed py-10 text-center">
              <p className="text-sm text-muted-foreground">No modules defined for this track yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {modules.map((module, idx) => {
                const checked = checkedIndices.has(idx);
                const locked = progress?.status === "completed" || progress?.status === "approved";
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={saving || locked || !isPartner}
                    onClick={() => handleToggleModule(idx)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl border bg-card px-4 py-3.5 text-left transition-colors",
                      checked
                        ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/10"
                        : "hover:bg-muted/30",
                      (locked || !isPartner) && "cursor-not-allowed opacity-80",
                    )}
                  >
                    <div className="mt-0.5 flex-shrink-0">
                      {checked ? (
                        <CheckSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Square className="h-4 w-4 text-muted-foreground/50" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className={cn(
                        "text-sm font-medium",
                        checked ? "text-emerald-700 dark:text-emerald-300 line-through opacity-75" : "text-foreground",
                      )}>
                        {idx + 1}. {module.title}
                      </p>
                      {module.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{module.description}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Submit for review */}
        {isPartner && allChecked && progress?.status === "in_progress" && (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-900/20">
            <div className="mb-3 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                All modules complete!
              </p>
            </div>
            <p className="mb-4 text-xs text-emerald-700 dark:text-emerald-300">
              Submit for certification review. Your agency owner will review your progress and
              approve your certification.
            </p>
            <button
              type="button"
              disabled={saving}
              onClick={handleSubmit}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Submit for review
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* What this unlocks */}
        <section className="rounded-xl border bg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <Award className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">What this certification unlocks</h2>
          </div>
          <p className="text-sm text-muted-foreground">{track.unlocksDescription}</p>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>
              Completing and getting approved adds this track to your partner profile, which is used
              to determine product eligibility.
            </span>
          </div>
        </section>

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl border bg-card px-4 py-2.5 shadow-lg">
            <p className="text-xs font-medium text-foreground">{toast}</p>
          </div>
        )}
      </div>
    </div>
  );
}
