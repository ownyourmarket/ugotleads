"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Award,
  BadgeCheck,
  Check,
  ChevronRight,
  ClipboardCopy,
  DollarSign,
  ShoppingBag,
  User,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { usePartnerProfile } from "@/hooks/use-partner-profile";
import { subscribeToCertifications } from "@/lib/firestore/partners";
import type { Certification } from "@/types/partner";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Track display metadata
// ---------------------------------------------------------------------------

const TRACK_ID_LABELS: Record<string, string> = {
  track_certified_ai_consultant: "Certified AI Consultant",
  track_community_advocate: "Community Advocate",
};

function trackLabel(id: string): string {
  return TRACK_ID_LABELS[id] ?? id;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  active:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  approved:
    "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  applied:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  suspended:
    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  terminated:
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
};

const TIER_STYLES: Record<string, string> = {
  elite:
    "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  certified:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  operator:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  community:
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PartnerProfilePage() {
  const { user, agencyId, agencyRole } = useAuth();
  const { subAccountId, agencyId: saAgencyId } = useSubAccount();

  const effectiveAgencyId = agencyId ?? saAgencyId;
  const isAdmin = agencyRole === "owner";

  const {
    profile: partnerProfile,
    track: activeTrack,
    loading: partnerLoading,
  } = usePartnerProfile(user?.uid);

  // ---- Certifications ----
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [certsLoading, setCertsLoading] = useState(true);

  useEffect(() => {
    if (!effectiveAgencyId) return;
    const unsub = subscribeToCertifications(
      effectiveAgencyId,
      (certs) => {
        setCertifications(certs);
        setCertsLoading(false);
      },
      (err) => {
        console.error("[partner-profile] subscribeToCertifications:", err);
        setCertsLoading(false);
      },
    );
    return () => unsub();
  }, [effectiveAgencyId]);

  // ---- Copy referral link ----
  const [copied, setCopied] = useState(false);

  const referralLink = useMemo(() => {
    if (!partnerProfile?.referralCode) return null;
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/?ref=${partnerProfile.referralCode}`;
  }, [partnerProfile?.referralCode]);

  function handleCopy() {
    if (!referralLink) return;
    void navigator.clipboard.writeText(referralLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ---- Certs earned by this partner (track id match) ----
  const earnedCerts = useMemo(() => {
    if (!partnerProfile) return [];
    const completedIds = partnerProfile.completedTrackIds ?? [];
    return certifications.filter((c) => completedIds.includes(c.trackId));
  }, [certifications, partnerProfile]);

  const loading = partnerLoading || certsLoading;

  // ---- No-partner empty state ----
  if (!loading && !partnerProfile) {
    return (
      <div className="min-h-screen space-y-8 p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-muted-foreground">
              <ShoppingBag className="h-4 w-4" />
              <span className="text-sm font-medium uppercase tracking-wider">
                Revenue OS
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Partner Profile
            </h1>
          </div>
        </div>

        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-16 text-center">
          <User className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-foreground">
              You are not enrolled as a partner yet.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Contact the agency owner to get a partner profile created for your
              account.
            </p>
          </div>
          {isAdmin && (
            <p className="rounded-lg border bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              Admin: use the dev bootstrap route to create a test profile.
            </p>
          )}
          <Link
            href={`/sa/${subAccountId}/marketplace`}
            className="inline-flex items-center gap-1.5 text-xs text-primary underline underline-offset-2"
          >
            <ChevronRight className="h-3 w-3" />
            Back to Marketplace
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-8 p-6">
      {/* ---- Header ---- */}
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-muted-foreground">
            <ShoppingBag className="h-4 w-4" />
            <span className="text-sm font-medium uppercase tracking-wider">
              Revenue OS
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Partner Profile
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your partner status, referral link, certifications, and commissions.
          </p>
        </div>

        <Link
          href={`/sa/${subAccountId}/marketplace`}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ShoppingBag className="h-3.5 w-3.5" />
          Marketplace
        </Link>
      </div>

      {/* ---- Loading skeleton ---- */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border bg-muted/40"
            />
          ))}
        </div>
      )}

      {!loading && partnerProfile && (
        <>
          {/* ---- Status + tier row ---- */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Status */}
            <div className="rounded-xl border bg-card p-4">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Status
              </p>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
                  STATUS_STYLES[partnerProfile.status] ??
                    "bg-muted text-muted-foreground",
                )}
              >
                {partnerProfile.status}
              </span>
            </div>

            {/* Tier */}
            <div className="rounded-xl border bg-card p-4">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Tier
              </p>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
                  TIER_STYLES[partnerProfile.tier] ??
                    "bg-muted text-muted-foreground",
                )}
              >
                {partnerProfile.tier}
              </span>
            </div>

            {/* Lifetime commissions */}
            <div className="rounded-xl border bg-card p-4">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Lifetime Earned
              </p>
              <p className="text-xl font-bold tabular-nums text-foreground">
                {formatCents(partnerProfile.lifetimeCommissionCents)}
              </p>
            </div>

            {/* Pending commissions */}
            <div className="rounded-xl border bg-card p-4">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Pending
              </p>
              <p className="text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                {formatCents(partnerProfile.pendingCommissionCents)}
              </p>
            </div>
          </div>

          {/* ---- Referral code + link ---- */}
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                Your Referral Link
              </h2>
            </div>

            {partnerProfile.referralCode ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Code:
                  </span>
                  <code className="rounded bg-muted px-2 py-0.5 text-sm font-mono font-bold tracking-widest text-foreground">
                    {partnerProfile.referralCode}
                  </code>
                </div>

                {referralLink && (
                  <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
                    <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
                      {referralLink}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className={cn(
                        "flex flex-shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        copied
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                          : "bg-primary text-primary-foreground hover:bg-primary/90",
                      )}
                    >
                      {copied ? (
                        <>
                          <Check className="h-3 w-3" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <ClipboardCopy className="h-3 w-3" />
                          Copy link
                        </>
                      )}
                    </button>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Share this link to refer new customers. When they sign up
                  using your link, you&apos;ll be credited as the referring
                  partner.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No referral code assigned yet. Contact the agency owner or use
                the bootstrap route to generate one.
              </p>
            )}
          </section>

          {/* ---- Completed tracks ---- */}
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <BadgeCheck className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                Completed Tracks
              </h2>
              <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                {(partnerProfile.completedTrackIds ?? []).length}
              </span>
            </div>

            {(partnerProfile.completedTrackIds ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tracks completed yet. Enroll in a certification track to
                unlock product sell permissions.
              </p>
            ) : (
              <ul className="space-y-2">
                {(partnerProfile.completedTrackIds ?? []).map((id) => (
                  <li
                    key={id}
                    className="flex items-center gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5"
                  >
                    <BadgeCheck className="h-4 w-4 flex-shrink-0 text-emerald-500" />
                    <span className="text-sm font-medium text-foreground">
                      {trackLabel(id)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---- Certifications ---- */}
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Award className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                Certifications Earned
              </h2>
              <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                {earnedCerts.length}
              </span>
            </div>

            {earnedCerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {(partnerProfile.completedTrackIds ?? []).length === 0
                  ? "Complete a certification track to earn your first badge."
                  : "No certifications are linked to your completed tracks yet."}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {earnedCerts.map((cert) => (
                  <div
                    key={cert.id}
                    className="flex items-start gap-3 rounded-xl border bg-gradient-to-br from-indigo-50 to-violet-50 p-4 dark:from-indigo-950/20 dark:to-violet-950/20"
                  >
                    {cert.badgeUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cert.badgeUrl}
                        alt={cert.name}
                        className="h-12 w-12 flex-shrink-0 rounded-lg object-contain"
                      />
                    ) : (
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                        <Award className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        {cert.name}
                      </p>
                      {cert.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {cert.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ---- Referred customers (placeholder — Phase 3 wires referral capture) ---- */}
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                Referred Customers
              </h2>
            </div>
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-8 text-center">
              <DollarSign className="h-7 w-7 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Referral tracking coming soon.
              </p>
              <p className="text-xs text-muted-foreground">
                Once referral capture is enabled, signups that use your link
                will appear here.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
