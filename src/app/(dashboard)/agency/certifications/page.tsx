"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Award,
  BadgeCheck,
  CheckCircle2,
  Clock,
  RotateCcw,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { subscribeToPartnerProfiles, updatePartnerProfile } from "@/lib/firestore/partners";
import { subscribeToPartnerTracks } from "@/lib/firestore/partners";
import {
  subscribeToAgencyTrackProgress,
  approveTrackProgress,
  revokeTrackProgress,
} from "@/lib/firestore/training";
import {
  subscribeToProducts,
  subscribeToAgencyEligibilities,
  updateProductEligibility,
} from "@/lib/firestore/products";
import { DEFAULT_TRACK_META } from "@/lib/training/content";
import type { PartnerProfile, PartnerTrack } from "@/types/partner";
import type { TrackProgress } from "@/types/training";
import type { Product, ProductEligibility, EligibilityRequirement } from "@/types/products";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(value: unknown): string {
  if (!value) return "—";
  const ts = value as { toDate?: () => Date };
  const d = typeof ts.toDate === "function" ? ts.toDate() : (value as Date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function partnerMeetsRequirement(completedTrackIds: string[], req: EligibilityRequirement): boolean {
  const hasCert = completedTrackIds.includes("track_certified_ai_consultant");
  const hasAdv = completedTrackIds.includes("track_community_advocate");
  switch (req) {
    case "none": return true;
    case "track_certified_ai_consultant": return hasCert;
    case "track_community_advocate": return hasAdv;
    case "either_track": return hasCert || hasAdv;
    case "both_tracks": return hasCert && hasAdv;
    case "manual_approval": return false;
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// Filter type
// ---------------------------------------------------------------------------

type FilterStatus = "all" | "completed" | "approved" | "in_progress" | "revoked";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgencyCertificationsPage() {
  const { agencyId, agencyRole, user } = useAuth();
  const isOwner = agencyRole === "owner";

  const [partners, setPartners] = useState<PartnerProfile[]>([]);
  const [tracks, setTracks] = useState<PartnerTrack[]>([]);
  const [allProgress, setAllProgress] = useState<TrackProgress[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [eligibilities, setEligibilities] = useState<ProductEligibility[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    if (!agencyId || !isOwner) { setLoading(false); return; }
    let done = 0;
    const check = () => { if (++done === 5) setLoading(false); };
    const u1 = subscribeToPartnerProfiles(agencyId, (d) => { setPartners(d); check(); }, () => check());
    const u2 = subscribeToPartnerTracks(agencyId, (d) => { setTracks(d); check(); }, () => check());
    const u3 = subscribeToAgencyTrackProgress(agencyId, (d) => { setAllProgress(d); check(); }, () => check());
    const u4 = subscribeToProducts(agencyId, (d) => { setProducts(d); check(); }, () => check());
    const u5 = subscribeToAgencyEligibilities(agencyId, (d) => { setEligibilities(d); check(); }, () => check());
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, [agencyId, isOwner]);

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  }

  // ---- Approval handler ----
  async function handleApprove(prog: TrackProgress) {
    if (!user?.uid) return;
    setProcessing(prog.id);
    try {
      // 1. Approve the track progress doc
      await approveTrackProgress(prog.id, user.uid);

      // 2. Add trackId to partner's completedTrackIds
      const partner = partners.find((p) => p.id === prog.partnerProfileId);
      if (partner) {
        const newTracks = [...new Set([...(partner.completedTrackIds ?? []), prog.trackId])];
        await updatePartnerProfile(prog.partnerProfileId, { completedTrackIds: newTracks });

        // 3. Auto-approve pending product eligibilities where requirement is now met
        //    (never auto-approve manual_approval products)
        const partnerEligibilities = eligibilities.filter(
          (e) => e.partnerProfileId === prog.partnerProfileId && e.status === "pending",
        );
        const autoApproveTargets = partnerEligibilities.filter((e) => {
          const product = products.find((p) => p.id === e.productId);
          if (!product) return false;
          const req = product.eligibilityRequirement ?? "manual_approval";
          if (req === "manual_approval") return false;
          return partnerMeetsRequirement(newTracks, req);
        });
        await Promise.all(
          autoApproveTargets.map((e) =>
            updateProductEligibility(e.partnerProfileId, e.productId, {
              status: "approved",
              reviewedByUid: user.uid,
            }),
          ),
        );

        const autoCount = autoApproveTargets.length;
        showToast(
          autoCount > 0
            ? `Certified! ${autoCount} product eligibilit${autoCount === 1 ? "y" : "ies"} auto-approved.`
            : "Certification approved.",
        );
      } else {
        showToast("Certification approved.");
      }
    } finally {
      setProcessing(null);
    }
  }

  // ---- Revoke handler ----
  async function handleRevoke(prog: TrackProgress) {
    if (!user?.uid) return;
    setProcessing(prog.id);
    try {
      // 1. Revoke the track progress
      await revokeTrackProgress(prog.id, user.uid);

      // 2. Remove trackId from partner's completedTrackIds
      const partner = partners.find((p) => p.id === prog.partnerProfileId);
      if (partner) {
        const newTracks = (partner.completedTrackIds ?? []).filter((t) => t !== prog.trackId);
        await updatePartnerProfile(prog.partnerProfileId, { completedTrackIds: newTracks });
      }
      showToast("Certification revoked.");
    } finally {
      setProcessing(null);
    }
  }

  // Build lookup maps
  const partnerMap = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners]);

  function trackName(trackId: string): string {
    const ft = tracks.find((t) => t.id === trackId);
    return ft?.name ?? DEFAULT_TRACK_META[trackId]?.name ?? trackId;
  }

  // Filtered and sorted progress rows
  const filtered = useMemo(() => {
    let list = allProgress;
    if (filterStatus !== "all") list = list.filter((p) => p.status === filterStatus);
    return [...list].sort((a, b) => {
      // completed (awaiting review) first
      const order = ["completed", "in_progress", "approved", "revoked"];
      const ao = order.indexOf(a.status);
      const bo = order.indexOf(b.status);
      if (ao !== bo) return ao - bo;
      const pa = partnerMap.get(a.partnerProfileId);
      const pb = partnerMap.get(b.partnerProfileId);
      return (pa?.fullName ?? "").localeCompare(pb?.fullName ?? "");
    });
  }, [allProgress, filterStatus, partnerMap]);

  const counts = useMemo(() => ({
    all: allProgress.length,
    completed: allProgress.filter((p) => p.status === "completed").length,
    in_progress: allProgress.filter((p) => p.status === "in_progress").length,
    approved: allProgress.filter((p) => p.status === "approved").length,
    revoked: allProgress.filter((p) => p.status === "revoked").length,
  }), [allProgress]);

  if (!isOwner) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <Award className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground">Agency owner access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-6 p-6">
      {/* Header */}
      <div>
        <div className="mb-1 flex items-center gap-2 text-muted-foreground">
          <Award className="h-4 w-4" />
          <span className="text-sm font-medium uppercase tracking-wider">Revenue OS — Agency</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Certifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review partner certification progress. Approving a track credits the partner and
          auto-approves eligible product rows.
        </p>
      </div>

      {/* Summary cards */}
      {!loading && (
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Awaiting review
            </p>
            <p className={cn("text-2xl font-bold tabular-nums", counts.completed > 0 ? "text-sky-600 dark:text-sky-400" : "text-foreground")}>
              {counts.completed}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">In progress</p>
            <p className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{counts.in_progress}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Certified</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{counts.approved}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Total rows</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{counts.all}</p>
          </div>
        </div>
      )}

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {(["all", "completed", "in_progress", "approved", "revoked"] as const).map((s) => {
          const labels: Record<string, string> = {
            all: "All",
            completed: "Awaiting review",
            in_progress: "In progress",
            approved: "Certified",
            revoked: "Revoked",
          };
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilterStatus(s)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filterStatus === s
                  ? "bg-primary text-primary-foreground"
                  : "border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {labels[s]}
              <span className="ml-1.5 tabular-nums opacity-60">{s === "all" ? counts.all : counts[s] ?? 0}</span>
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-16 text-center">
          <Award className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {allProgress.length === 0
              ? "No partners have started certification tracks yet."
              : "No entries match this filter."}
          </p>
        </div>
      )}

      {/* Progress table */}
      {!loading && filtered.length > 0 && (
        <div className="rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Partner</th>
                  <th className="px-4 py-3 font-medium">Track</th>
                  <th className="px-4 py-3 font-medium">Progress</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Approved</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((prog) => {
                  const partner = partnerMap.get(prog.partnerProfileId);
                  const name = partner?.displayName ?? partner?.fullName ?? prog.partnerProfileId;
                  const modules = prog.totalModules;
                  const done = prog.completedModuleIndices.length;
                  const pct = modules > 0 ? Math.round((done / modules) * 100) : 0;
                  const isProcessing = processing === prog.id;

                  return (
                    <tr key={prog.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <p className="text-xs font-medium text-foreground">{name}</p>
                        {partner && (
                          <p className="text-[11px] capitalize text-muted-foreground">{partner.status}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {trackName(prog.trackId)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                prog.status === "approved" ? "bg-emerald-500" : "bg-primary/70",
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {done}/{modules}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          prog.status === "approved"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : prog.status === "completed"
                              ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
                              : prog.status === "revoked"
                                ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                        )}>
                          {prog.status === "approved" && <BadgeCheck className="h-2.5 w-2.5" />}
                          {prog.status === "completed" && <Clock className="h-2.5 w-2.5" />}
                          {prog.status === "approved" ? "Certified" : prog.status === "completed" ? "Review" : prog.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {fmtDate(prog.completedAt)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {fmtDate(prog.approvedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {prog.status === "completed" && (
                            <button
                              type="button"
                              disabled={isProcessing}
                              onClick={() => handleApprove(prog)}
                              className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 disabled:opacity-60"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              {isProcessing ? "Approving…" : "Approve"}
                            </button>
                          )}
                          {prog.status === "approved" && (
                            <button
                              type="button"
                              disabled={isProcessing}
                              onClick={() => handleRevoke(prog)}
                              className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 disabled:opacity-60"
                            >
                              <RotateCcw className="h-3 w-3" />
                              {isProcessing ? "Revoking…" : "Revoke"}
                            </button>
                          )}
                          {(prog.status === "in_progress" || prog.status === "revoked") && (
                            <span className="text-[11px] text-muted-foreground/50">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border bg-card px-4 py-3 shadow-lg">
          <p className="text-sm font-medium text-foreground">{toastMsg}</p>
        </div>
      )}
    </div>
  );
}
