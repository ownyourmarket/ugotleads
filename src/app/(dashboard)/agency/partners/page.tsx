"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Award,
  BadgeCheck,
  ChevronDown,
  ClipboardCopy,
  DollarSign,
  Pencil,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  subscribeToPartnerProfiles,
  createPartnerProfile,
  updatePartnerProfile,
  getPartnerProfile,
} from "@/lib/firestore/partners";
import {
  subscribeToPartnerEligibilities,
  subscribeToProducts,
  updateProductEligibility,
} from "@/lib/firestore/products";
import { subscribeToPartnerReferrals } from "@/lib/firestore/partner-referrals";
import { subscribeToPartnerCommissionEvents } from "@/lib/firestore/commission";
import { subscribeToAttributedPurchases } from "@/lib/firestore/marketplace-purchases";
import type { PartnerProfile, PartnerStatus, PartnerTier } from "@/types/partner";
import type { PartnerReferral } from "@/types/credits";
import type { CommissionEvent } from "@/types/credits";
import type { MarketplacePurchase } from "@/types/marketplace";
import type { ProductEligibility, Product } from "@/types/products";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRACK_IDS = ["track_certified_ai_consultant", "track_community_advocate"] as const;

const TRACK_LABELS: Record<string, string> = {
  track_certified_ai_consultant: "Certified AI Consultant",
  track_community_advocate: "Community Advocate",
};

const TIERS: PartnerTier[] = ["community", "operator", "certified", "elite"];

const TIER_LABELS: Record<PartnerTier, string> = {
  community: "Community",
  operator: "Operator",
  certified: "Certified",
  elite: "Elite",
};

const STATUS_STYLES: Record<PartnerStatus, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  approved: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  applied: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  suspended: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  terminated: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const ELIGIBILITY_STATUS_STYLES: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  denied: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  revoked: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function fmtDate(value: unknown): string {
  if (!value) return "—";
  const ts = value as { toDate?: () => Date };
  const d = typeof ts.toDate === "function" ? ts.toDate() : (value as Date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function generateReferralCode(): string {
  // Unambiguous uppercase alphanumeric (no I, O, 0, 1 to avoid confusion)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: PartnerStatus }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold capitalize tracking-wide",
      STATUS_STYLES[status] ?? "bg-muted text-muted-foreground",
    )}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Partner detail panel
// ---------------------------------------------------------------------------

type DetailTab = "overview" | "eligibility" | "activity";

interface PartnerDetailPanelProps {
  partner: PartnerProfile;
  agencyId: string;
  uid: string;   // the acting admin uid
  products: Product[];
  onClose: () => void;
  onPartnerUpdated: () => void;
}

function PartnerDetailPanel({
  partner,
  agencyId,
  uid,
  products,
  onClose,
}: PartnerDetailPanelProps) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const [toast, setToast] = useState<string | null>(null);

  // ---- Partner-scoped subscriptions (lazy-loaded on open) ----
  const [eligibilities, setEligibilities] = useState<ProductEligibility[]>([]);
  const [referrals, setReferrals] = useState<PartnerReferral[]>([]);
  const [commissions, setCommissions] = useState<CommissionEvent[]>([]);
  const [purchases, setPurchases] = useState<MarketplacePurchase[]>([]);

  useEffect(() => {
    const u1 = subscribeToPartnerEligibilities(partner.id, setEligibilities, console.error);
    const u2 = subscribeToPartnerReferrals(partner.id, setReferrals, console.error);
    const u3 = subscribeToPartnerCommissionEvents(partner.id, setCommissions, console.error);
    const u4 = subscribeToAttributedPurchases(partner.id, setPurchases, console.error);
    return () => { u1(); u2(); u3(); u4(); };
  }, [partner.id]);

  // ---- Local editable state ----
  const [editingCode, setEditingCode] = useState(false);
  const [codeInput, setCodeInput] = useState(partner.referralCode ?? "");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState(partner.internalNotes ?? "");
  const [saving, setSaving] = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  // ---- Status actions ----
  async function handleStatusChange(newStatus: PartnerStatus) {
    setSaving(true);
    try {
      const updates: Parameters<typeof updatePartnerProfile>[1] = { status: newStatus };
      if (newStatus === "approved" || newStatus === "active") {
        updates.approvedByUid = uid;
      }
      await updatePartnerProfile(partner.id, updates);
      showToast(`Status set to ${newStatus}.`);
    } finally {
      setSaving(false);
    }
  }

  // ---- Tier change ----
  async function handleTierChange(tier: PartnerTier) {
    if (tier === partner.tier) return;
    setSaving(true);
    try {
      await updatePartnerProfile(partner.id, { tier });
      showToast(`Tier set to ${TIER_LABELS[tier]}.`);
    } finally {
      setSaving(false);
    }
  }

  // ---- Track management ----
  async function addTrack(trackId: string) {
    const current = partner.completedTrackIds ?? [];
    if (current.includes(trackId)) return;
    await updatePartnerProfile(partner.id, {
      completedTrackIds: [...current, trackId],
    });
    showToast(`Track "${TRACK_LABELS[trackId]}" assigned.`);
  }

  async function removeTrack(trackId: string) {
    const current = partner.completedTrackIds ?? [];
    if (!current.includes(trackId)) return;
    await updatePartnerProfile(partner.id, {
      completedTrackIds: current.filter((t) => t !== trackId),
    });
    showToast(`Track "${TRACK_LABELS[trackId]}" removed.`);
  }

  // ---- Referral code ----
  async function handleSaveCode() {
    const trimmed = codeInput.trim().toUpperCase();
    if (!trimmed) return;
    await updatePartnerProfile(partner.id, { referralCode: trimmed });
    setEditingCode(false);
    showToast("Referral code updated.");
  }

  async function handleRegenerateCode() {
    const newCode = generateReferralCode();
    await updatePartnerProfile(partner.id, { referralCode: newCode });
    setCodeInput(newCode);
    showToast(`Code regenerated: ${newCode}`);
  }

  // ---- Internal notes ----
  async function handleSaveNotes() {
    await updatePartnerProfile(partner.id, { internalNotes: notesInput.trim() || null });
    setEditingNotes(false);
    showToast("Notes saved.");
  }

  // ---- Product eligibility inline actions ----
  async function handleEligibilityAction(
    e: ProductEligibility,
    newStatus: "approved" | "pending" | "denied" | "revoked",
  ) {
    await updateProductEligibility(e.partnerProfileId, e.productId, {
      status: newStatus,
      reviewedByUid: uid,
    });
    showToast(`Set to ${newStatus}.`);
  }

  // Product id → name lookup
  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const completedTracks = partner.completedTrackIds ?? [];
  const isActive = partner.status === "active" || partner.status === "approved";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l bg-background shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-foreground">
                {partner.displayName ?? partner.fullName}
              </h2>
              <StatusBadge status={partner.status} />
            </div>
            <p className="text-xs text-muted-foreground">{partner.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 flex-shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          {(["overview", "eligibility", "activity"] as DetailTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "px-5 py-2.5 text-xs font-medium capitalize transition-colors",
                tab === t
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* ── OVERVIEW TAB ── */}
          {tab === "overview" && (
            <>
              {/* Stats */}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border bg-muted/30 p-3 text-center">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Lifetime</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-foreground">
                    {fmtUsd(partner.lifetimeCommissionCents)}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/30 p-3 text-center">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Pending</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">
                    {fmtUsd(partner.pendingCommissionCents)}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/30 p-3 text-center">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Sales vol.</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-foreground">
                    {fmtUsd(
                      purchases
                        .filter((p) => p.paymentStatus === "paid")
                        .reduce((s, p) => s + p.amountTotalCents, 0),
                    )}
                  </p>
                </div>
              </div>

              {/* Status actions */}
              <section className="rounded-xl border bg-card p-4">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Status actions
                </p>
                <div className="flex flex-wrap gap-2">
                  {partner.status === "applied" && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleStatusChange("approved")}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      Approve
                    </button>
                  )}
                  {(partner.status === "approved" || partner.status === "applied") && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleStatusChange("active")}
                      className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-60"
                    >
                      Set Active
                    </button>
                  )}
                  {isActive && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleStatusChange("suspended")}
                      className="rounded-lg border bg-card px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60"
                    >
                      Suspend
                    </button>
                  )}
                  {partner.status === "suspended" && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleStatusChange("active")}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      Reactivate
                    </button>
                  )}
                  {partner.status !== "terminated" && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleStatusChange("terminated")}
                      className="rounded-lg border px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-muted disabled:opacity-60"
                    >
                      Terminate
                    </button>
                  )}
                </div>
                {partner.status === "suspended" && (
                  <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
                    Suspended partners cannot earn new commissions.
                  </p>
                )}
                {partner.status === "terminated" && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Partner is terminated. Records are preserved.
                  </p>
                )}
              </section>

              {/* Tier */}
              <section className="rounded-xl border bg-card p-4">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Partner tier
                </p>
                <div className="relative">
                  <select
                    value={partner.tier}
                    onChange={(e) => handleTierChange(e.target.value as PartnerTier)}
                    disabled={saving}
                    className="w-full appearance-none rounded-lg border bg-background px-3 py-2 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                  >
                    {TIERS.map((t) => (
                      <option key={t} value={t}>{TIER_LABELS[t]}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                </div>
              </section>

              {/* Tracks */}
              <section className="rounded-xl border bg-card p-4">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Certification tracks
                </p>
                <div className="space-y-2">
                  {TRACK_IDS.map((trackId) => {
                    const assigned = completedTracks.includes(trackId);
                    return (
                      <div key={trackId} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          {assigned ? (
                            <BadgeCheck className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
                          )}
                          <span className="text-xs font-medium text-foreground">
                            {TRACK_LABELS[trackId]}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => assigned ? removeTrack(trackId) : addTrack(trackId)}
                          className={cn(
                            "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                            assigned
                              ? "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400"
                              : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300",
                          )}
                        >
                          {assigned ? "Remove" : "Assign"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Referral code */}
              <section className="rounded-xl border bg-card p-4">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Referral code
                </p>
                {editingCode ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                      maxLength={12}
                      className="flex-1 rounded-lg border bg-background px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button
                      type="button"
                      onClick={handleSaveCode}
                      className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingCode(false); setCodeInput(partner.referralCode ?? ""); }}
                      className="rounded-lg border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    {partner.referralCode ? (
                      <code className="rounded-lg bg-muted px-3 py-2 font-mono text-sm font-bold tracking-widest text-foreground">
                        {partner.referralCode}
                      </code>
                    ) : (
                      <span className="text-sm text-muted-foreground">No code assigned</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditingCode(true)}
                      title="Edit code"
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleRegenerateCode}
                      title="Regenerate code"
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Partners share this code in their referral link. Changing the code
                  invalidates the old link immediately.
                </p>
              </section>

              {/* Internal notes */}
              <section className="rounded-xl border bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Internal notes
                  </p>
                  {!editingNotes && (
                    <button
                      type="button"
                      onClick={() => setEditingNotes(true)}
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {editingNotes ? (
                  <div className="space-y-2">
                    <textarea
                      value={notesInput}
                      onChange={(e) => setNotesInput(e.target.value)}
                      rows={4}
                      className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="Agency-owner visible only. Partners cannot see this."
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSaveNotes}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditingNotes(false); setNotesInput(partner.internalNotes ?? ""); }}
                        className="rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {partner.internalNotes || <span className="italic opacity-50">No notes.</span>}
                  </p>
                )}
              </section>

              {/* Info row */}
              <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
                <div><span className="font-medium text-foreground">UID:</span>{" "}<code className="font-mono">{partner.uid}</code></div>
                <div><span className="font-medium text-foreground">Joined:</span> {fmtDate(partner.createdAt)}</div>
                <div><span className="font-medium text-foreground">Territory:</span> {partner.territory ?? "—"}</div>
                <div><span className="font-medium text-foreground">City/State:</span> {[partner.city, partner.state].filter(Boolean).join(", ") || "—"}</div>
              </div>
            </>
          )}

          {/* ── ELIGIBILITY TAB ── */}
          {tab === "eligibility" && (
            <section>
              <p className="mb-4 text-xs text-muted-foreground">
                Product eligibility rows for this partner. Approved means the partner can sell and earn
                commission from that product. Missing means no row exists — not the same as approved.
              </p>
              {eligibilities.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
                  <ShieldCheck className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    No eligibility rows. Use the Product Eligibility manager to generate rows.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-2.5 font-medium">Product</th>
                        <th className="px-3 py-2.5 font-medium">Status</th>
                        <th className="px-3 py-2.5 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {eligibilities.map((e) => {
                        const product = productMap.get(e.productId);
                        return (
                          <tr key={e.id} className="hover:bg-muted/20">
                            <td className="px-3 py-2.5">
                              <p className="text-xs font-medium text-foreground">
                                {product?.name ?? e.productId}
                              </p>
                              {product?.productFamily && (
                                <p className="text-[11px] capitalize text-muted-foreground">
                                  {product.productFamily.replace(/_/g, " ")}
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                ELIGIBILITY_STATUS_STYLES[e.status] ?? "bg-muted text-muted-foreground",
                              )}>
                                {e.status}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {e.status !== "approved" && (
                                  <button
                                    type="button"
                                    onClick={() => handleEligibilityAction(e, "approved")}
                                    className="rounded px-2 py-0.5 text-[11px] font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300"
                                  >
                                    Approve
                                  </button>
                                )}
                                {e.status !== "pending" && (
                                  <button
                                    type="button"
                                    onClick={() => handleEligibilityAction(e, "pending")}
                                    className="rounded px-2 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300"
                                  >
                                    Pending
                                  </button>
                                )}
                                {e.status !== "revoked" && e.status !== "denied" && (
                                  <button
                                    type="button"
                                    onClick={() => handleEligibilityAction(e, "revoked")}
                                    className="rounded px-2 py-0.5 text-[11px] font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"
                                  >
                                    Revoke
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ── ACTIVITY TAB ── */}
          {tab === "activity" && (
            <div className="space-y-6">
              {/* Attributed purchases */}
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">
                    Attributed sales
                  </h3>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                    {purchases.filter((p) => p.paymentStatus === "paid").length}
                  </span>
                </div>
                {purchases.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No attributed purchases yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Product</th>
                          <th className="px-3 py-2 font-medium">Amount</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {purchases.slice(0, 10).map((p) => (
                          <tr key={p.id} className="text-xs hover:bg-muted/20">
                            <td className="px-3 py-2 font-medium text-foreground">{p.productName}</td>
                            <td className="px-3 py-2 tabular-nums text-foreground">
                              {fmtUsd(p.amountTotalCents)}
                            </td>
                            <td className="px-3 py-2">
                              <span className={cn(
                                "inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                p.paymentStatus === "paid"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                              )}>
                                {p.paymentStatus === "paid" ? "Paid" : p.paymentStatus === "no_payment_required" ? "Free" : "Unpaid"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{fmtDate(p.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Commission events */}
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">Commission events</h3>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                    {commissions.length}
                  </span>
                </div>
                {commissions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No commission events yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Amount</th>
                          <th className="px-3 py-2 font-medium">Pct</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {commissions.slice(0, 10).map((c) => (
                          <tr key={c.id} className="text-xs hover:bg-muted/20">
                            <td className="px-3 py-2 tabular-nums font-medium text-foreground">
                              {fmtUsd(c.commissionCents)}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{c.commissionPct}%</td>
                            <td className="px-3 py-2">
                              <span className={cn(
                                "inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                c.status === "paid"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                                  : c.status === "voided"
                                    ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                              )}>
                                {c.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{fmtDate(c.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Referred customers */}
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">Referred customers</h3>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                    {referrals.length}
                  </span>
                </div>
                {referrals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No referred customers yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Email</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {referrals.slice(0, 10).map((r) => (
                          <tr key={r.id} className="text-xs hover:bg-muted/20">
                            <td className="px-3 py-2 text-muted-foreground">{r.refereeEmail}</td>
                            <td className="px-3 py-2">
                              <span className={cn(
                                "inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                r.status === "converted"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                                  : r.status === "voided"
                                    ? "bg-zinc-100 text-zinc-500"
                                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                              )}>
                                {r.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-xl border bg-card px-4 py-2.5 shadow-lg">
            <p className="text-xs font-medium text-foreground">{toast}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create partner modal
// ---------------------------------------------------------------------------

interface CreatePartnerModalProps {
  agencyId: string;
  createdByUid: string;
  onClose: () => void;
}

function CreatePartnerModal({ agencyId, createdByUid, onClose }: CreatePartnerModalProps) {
  const [uid, setUid] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<PartnerTier>("community");
  const [status, setStatus] = useState<PartnerStatus>("applied");
  const [referralCode, setReferralCode] = useState(generateReferralCode());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    const trimUid = uid.trim();
    const trimName = fullName.trim();
    const trimEmail = email.trim();
    if (!trimUid) { setError("Firebase User UID is required."); return; }
    if (!trimName) { setError("Full name is required."); return; }
    if (!referralCode.trim()) { setError("Referral code is required."); return; }

    setSaving(true);
    setError(null);

    try {
      // Safety check: don't overwrite an existing profile
      const existing = await getPartnerProfile(trimUid);
      if (existing) {
        setError(`A partner profile already exists for UID ${trimUid}.`);
        return;
      }

      await createPartnerProfile(trimUid, {
        uid: trimUid,
        agencyId,
        email: trimEmail || `${trimUid}@placeholder.local`,
        fullName: trimName,
        displayName: null,
        phone: null,
        city: null,
        state: null,
        country: "US",
        territory: null,
        status,
        tier,
        accessModel: "subscription",
        stripeSubscriptionId: null,
        subAccountId: null,
        activeTrackId: null,
        completedTrackIds: [],
        referralCode: referralCode.trim().toUpperCase(),
        approvedByUid: status === "approved" || status === "active" ? createdByUid : null,
        approvedAt: null,
        internalNotes: null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md rounded-xl border bg-background p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Create partner profile</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* UID note */}
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            <strong>Requires an existing Firebase user.</strong> Find the UID in Firebase Console →
            Authentication → Users. The user must have already signed up.
            {/* TODO: add user search when user lookup API is built */}
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Firebase User UID <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={uid}
              onChange={(e) => setUid(e.target.value.trim())}
              placeholder="e.g. abc123XYZ..."
              className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Full name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="First Last"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="partner@email.com"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Tier</label>
              <div className="relative">
                <select
                  value={tier}
                  onChange={(e) => setTier(e.target.value as PartnerTier)}
                  className="w-full appearance-none rounded-lg border bg-background px-3 py-2 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {TIERS.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
              <div className="relative">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as PartnerStatus)}
                  className="w-full appearance-none rounded-lg border bg-background px-3 py-2 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="applied">Applied</option>
                  <option value="approved">Approved</option>
                  <option value="active">Active</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Referral code <span className="text-destructive">*</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                maxLength={12}
                className="flex-1 rounded-lg border bg-background px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={() => setReferralCode(generateReferralCode())}
                title="Regenerate"
                className="rounded-md p-2 text-muted-foreground hover:bg-muted"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleCreate}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? "Creating…" : "Create partner"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type FilterStatus = "all" | PartnerStatus;

export default function AgencyPartnersPage() {
  const { agencyId, agencyRole, user } = useAuth();
  const isOwner = agencyRole === "owner";

  const [partners, setPartners] = useState<PartnerProfile[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");
  const [selectedPartner, setSelectedPartner] = useState<PartnerProfile | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!agencyId || !isOwner) { setLoading(false); return; }
    let done = 0;
    const check = () => { if (++done === 2) setLoading(false); };
    const u1 = subscribeToPartnerProfiles(agencyId, (d) => { setPartners(d); check(); }, () => check());
    const u2 = subscribeToProducts(agencyId, (d) => { setProducts(d); check(); }, () => check());
    return () => { u1(); u2(); };
  }, [agencyId, isOwner]);

  // Update selectedPartner when partner list updates (e.g. after status change)
  useEffect(() => {
    if (!selectedPartner) return;
    const updated = partners.find((p) => p.id === selectedPartner.id);
    if (updated) setSelectedPartner(updated);
  }, [partners]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    let list = partners;
    if (filterStatus !== "all") list = list.filter((p) => p.status === filterStatus);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.fullName.toLowerCase().includes(q) ||
          p.email.toLowerCase().includes(q) ||
          (p.displayName ?? "").toLowerCase().includes(q) ||
          (p.referralCode ?? "").toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => {
      const order: PartnerStatus[] = ["active", "approved", "applied", "suspended", "terminated"];
      const ao = order.indexOf(a.status);
      const bo = order.indexOf(b.status);
      if (ao !== bo) return ao - bo;
      return a.fullName.localeCompare(b.fullName);
    });
  }, [partners, filterStatus, search]);

  const counts = useMemo(() => ({
    all: partners.length,
    active: partners.filter((p) => p.status === "active").length,
    approved: partners.filter((p) => p.status === "approved").length,
    applied: partners.filter((p) => p.status === "applied").length,
    suspended: partners.filter((p) => p.status === "suspended").length,
    terminated: partners.filter((p) => p.status === "terminated").length,
  }), [partners]);

  function copyCode(code: string) {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  if (!isOwner) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <Users className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground">Agency owner access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-muted-foreground">
            <Users className="h-4 w-4" />
            <span className="text-sm font-medium uppercase tracking-wider">Revenue OS — Agency</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Partners</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage partner profiles, certifications, referral codes, and commissions.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <UserPlus className="h-4 w-4" />
          Add partner
        </button>
      </div>

      {/* Summary cards */}
      {!loading && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Active</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {counts.active + counts.approved}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Applied</p>
            <p className={cn("text-2xl font-bold tabular-nums", counts.applied > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
              {counts.applied}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Total enrolled</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{counts.all}</p>
          </div>
        </div>
      )}

      {/* Filter + search bar */}
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "active", "approved", "applied", "suspended", "terminated"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilterStatus(s)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors",
              filterStatus === s
                ? "bg-primary text-primary-foreground"
                : "border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {s === "all" ? "All" : s}
            <span className="ml-1.5 tabular-nums opacity-60">
              {s === "all" ? counts.all : counts[s] ?? 0}
            </span>
          </button>
        ))}
        <div className="ml-auto">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, code…"
            className="rounded-lg border bg-card px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 w-52"
          />
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-16 text-center">
          <Users className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {partners.length === 0
              ? "No partner profiles yet."
              : "No partners match this filter."}
          </p>
        </div>
      )}

      {/* Partner table */}
      {!loading && filtered.length > 0 && (
        <div className="rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Partner</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Tier</th>
                  <th className="px-4 py-3 font-medium">Tracks</th>
                  <th className="px-4 py-3 font-medium">Referral code</th>
                  <th className="px-4 py-3 font-medium">Pending</th>
                  <th className="px-4 py-3 font-medium">Lifetime</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((p) => {
                  const completedTracks = p.completedTrackIds ?? [];
                  return (
                    <tr
                      key={p.id}
                      className={cn(
                        "cursor-pointer hover:bg-muted/20 transition-colors",
                        p.status === "terminated" && "opacity-60",
                      )}
                      onClick={() => setSelectedPartner(p)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">
                          {p.displayName ?? p.fullName}
                        </p>
                        <p className="text-xs text-muted-foreground">{p.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs capitalize text-muted-foreground">{p.tier}</span>
                      </td>
                      <td className="px-4 py-3">
                        {completedTracks.length === 0 ? (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        ) : (
                          <div className="flex gap-1">
                            {completedTracks.map((t) => (
                              <span key={t} title={TRACK_LABELS[t] ?? t}>
                                <Award className="h-3.5 w-3.5 text-indigo-500" />
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.referralCode ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); copyCode(p.referralCode!); }}
                            className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] tracking-widest text-foreground hover:bg-muted/80"
                            title="Copy"
                          >
                            {copied === p.referralCode ? "Copied!" : p.referralCode}
                            <ClipboardCopy className="h-3 w-3 text-muted-foreground" />
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-xs text-amber-600 dark:text-amber-400">
                        {fmtUsd(p.pendingCommissionCents)}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-xs text-foreground">
                        {fmtUsd(p.lifetimeCommissionCents)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {fmtDate(p.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selectedPartner && (
        <PartnerDetailPanel
          partner={selectedPartner}
          agencyId={agencyId ?? ""}
          uid={user?.uid ?? ""}
          products={products}
          onClose={() => setSelectedPartner(null)}
          onPartnerUpdated={() => {/* real-time via subscribeToPartnerProfiles */}}
        />
      )}

      {/* Create modal */}
      {showCreate && (
        <CreatePartnerModal
          agencyId={agencyId ?? ""}
          createdByUid={user?.uid ?? ""}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
