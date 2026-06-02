"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  ChevronDown,
  ClipboardList,
  Package,
  ShieldCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  writeBatch,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  subscribeToProducts,
  updateProduct,
  subscribeToAgencyEligibilities,
  updateProductEligibility,
  setProductEligibility,
  eligibilityDocId,
} from "@/lib/firestore/products";
import { subscribeToPartnerProfiles } from "@/lib/firestore/partners";
import type { Product, ProductEligibility, EligibilityRequirement } from "@/types/products";
import type { PartnerProfile } from "@/types/partner";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUIREMENT_OPTIONS: { value: EligibilityRequirement; label: string; hint: string }[] = [
  {
    value: "none",
    label: "No requirement",
    hint: "Any active or approved partner can sell this product.",
  },
  {
    value: "track_certified_ai_consultant",
    label: "Certified AI Consultant required",
    hint: "Partner must have completed the Certified AI Consultant track.",
  },
  {
    value: "track_community_advocate",
    label: "Community Advocate required",
    hint: "Partner must have completed the Community Advocate track.",
  },
  {
    value: "either_track",
    label: "Either track required",
    hint: "Partner must have completed at least one of the two main tracks.",
  },
  {
    value: "both_tracks",
    label: "Both tracks required",
    hint: "Partner must have completed both certification tracks.",
  },
  {
    value: "manual_approval",
    label: "Manual approval only",
    hint: "Agency owner must explicitly approve each partner. No auto-approval.",
  },
];

const ELIGIBILITY_STATUS_STYLES: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  denied: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  revoked: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const TRACK_LABELS: Record<string, string> = {
  track_certified_ai_consultant: "Certified AI Consultant",
  track_community_advocate: "Community Advocate",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function effectiveRequirement(p: Product): EligibilityRequirement {
  return p.eligibilityRequirement ?? "manual_approval";
}

function requirementLabel(req: EligibilityRequirement): string {
  return REQUIREMENT_OPTIONS.find((r) => r.value === req)?.label ?? req;
}

/** Returns true if the partner's completed tracks satisfy the requirement. */
function partnerMeetsRequirement(
  completedTrackIds: string[],
  req: EligibilityRequirement,
): boolean {
  const hasCertified = completedTrackIds.includes("track_certified_ai_consultant");
  const hasAdvocate = completedTrackIds.includes("track_community_advocate");
  switch (req) {
    case "none": return true;
    case "track_certified_ai_consultant": return hasCertified;
    case "track_community_advocate": return hasAdvocate;
    case "either_track": return hasCertified || hasAdvocate;
    case "both_tracks": return hasCertified && hasAdvocate;
    case "manual_approval": return false; // never auto-approve
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// Eligibility status badge
// ---------------------------------------------------------------------------

function EligibilityBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        ELIGIBILITY_STATUS_STYLES[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Requirement badge (compact)
// ---------------------------------------------------------------------------

function RequirementBadge({ req }: { req: EligibilityRequirement }) {
  const colors: Record<EligibilityRequirement, string> = {
    none: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    track_certified_ai_consultant: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
    track_community_advocate: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
    either_track: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    both_tracks: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    manual_approval: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  };
  const labels: Record<EligibilityRequirement, string> = {
    none: "None",
    track_certified_ai_consultant: "AI Consultant",
    track_community_advocate: "Advocate",
    either_track: "Either track",
    both_tracks: "Both tracks",
    manual_approval: "Manual",
  };
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", colors[req])}>
      {labels[req]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Manage product panel (right slide-over)
// ---------------------------------------------------------------------------

interface ManagePanelProps {
  product: Product;
  partners: PartnerProfile[];
  eligibilities: ProductEligibility[];
  uid: string;
  agencyId: string;
  onClose: () => void;
}

function ManagePanel({ product, partners, eligibilities, uid, agencyId, onClose }: ManagePanelProps) {
  const req = effectiveRequirement(product);
  const [selectedReq, setSelectedReq] = useState<EligibilityRequirement>(req);
  const [savingReq, setSavingReq] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  }

  async function handleSaveRequirement() {
    if (selectedReq === req) return;
    setSavingReq(true);
    setReqError(null);
    try {
      await updateProduct(product.id, { eligibilityRequirement: selectedReq });
      showToast("Requirement saved.");
    } catch (err) {
      setReqError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSavingReq(false);
    }
  }

  // Partner eligibility rows for this product
  const productEligibilities = useMemo(
    () => eligibilities.filter((e) => e.productId === product.id),
    [eligibilities, product.id],
  );

  // Partner id → profile lookup
  const partnerMap = useMemo(
    () => new Map(partners.map((p) => [p.id, p])),
    [partners],
  );

  // Active/approved partners without an eligibility row for this product
  const activePartners = useMemo(
    () => partners.filter((p) => p.status === "active" || p.status === "approved"),
    [partners],
  );
  const coveredPartnerIds = new Set(productEligibilities.map((e) => e.partnerProfileId));
  const missingCount = activePartners.filter((p) => !coveredPartnerIds.has(p.id)).length;

  async function handleAction(e: ProductEligibility, newStatus: "approved" | "pending" | "denied" | "revoked") {
    await updateProductEligibility(e.partnerProfileId, e.productId, {
      status: newStatus,
      reviewedByUid: uid,
    });
    showToast(`Set to ${newStatus}.`);
  }

  async function handleGenerateMissingForProduct() {
    const missing = activePartners.filter((p) => !coveredPartnerIds.has(p.id));
    if (missing.length === 0) return;
    const db = getFirebaseDb();
    const batch = writeBatch(db);
    for (const partner of missing) {
      const docId = eligibilityDocId(partner.id, product.id);
      const ref = doc(db, "product_eligibility", docId);
      batch.set(ref, {
        id: docId,
        agencyId,
        partnerProfileId: partner.id,
        productId: product.id,
        status: "pending",
        accessModel: product.accessModel,
        stripeSubscriptionId: null,
        byokKey: null,
        byokKeyLast4: null,
        byokKeyValidatedAt: null,
        reviewedByUid: null,
        reviewedAt: null,
        reviewNote: null,
        expiresAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
    showToast(`Created ${missing.length} missing row${missing.length !== 1 ? "s" : ""}.`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Eligibility for
            </p>
            <h2 className="truncate text-sm font-semibold text-foreground">{product.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 flex-shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Requirement editor */}
          <section className="rounded-xl border bg-muted/30 p-4">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Sell / earn requirement
            </p>
            <div className="relative mb-3">
              <select
                value={selectedReq}
                onChange={(e) => setSelectedReq(e.target.value as EligibilityRequirement)}
                className="w-full appearance-none rounded-lg border bg-background px-3 py-2 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {REQUIREMENT_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              {REQUIREMENT_OPTIONS.find((r) => r.value === selectedReq)?.hint}
            </p>
            {reqError && (
              <p className="mb-2 text-xs text-destructive">{reqError}</p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={savingReq || selectedReq === req}
                onClick={handleSaveRequirement}
                className="rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {savingReq ? "Saving…" : "Save requirement"}
              </button>
              {selectedReq === req && (
                <span className="text-xs text-muted-foreground">No changes</span>
              )}
            </div>
          </section>

          {/* Partner eligibility table */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Partner eligibility</h3>
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                  {productEligibilities.length}
                </span>
              </div>
              {missingCount > 0 && (
                <button
                  type="button"
                  onClick={handleGenerateMissingForProduct}
                  className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <AlertTriangle className="h-3 w-3" />
                  Generate {missingCount} missing row{missingCount !== 1 ? "s" : ""}
                </button>
              )}
            </div>

            {productEligibilities.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-10 text-center">
                <ClipboardList className="h-8 w-8 text-muted-foreground/30" />
                <div>
                  <p className="text-sm text-muted-foreground">No eligibility rows yet.</p>
                  {missingCount > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {missingCount} active partner{missingCount !== 1 ? "s" : ""} without a row.
                      Click "Generate missing rows" above.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2.5 font-medium">Partner</th>
                      <th className="px-3 py-2.5 font-medium">Tracks</th>
                      <th className="px-3 py-2.5 font-medium">Eligibility</th>
                      <th className="px-3 py-2.5 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {productEligibilities.map((e) => {
                      const partner = partnerMap.get(e.partnerProfileId);
                      const name = partner?.displayName ?? partner?.fullName ?? e.partnerProfileId;
                      const completedTracks = partner?.completedTrackIds ?? [];
                      const meetsReq = partnerMeetsRequirement(completedTracks, effectiveRequirement(product));
                      return (
                        <tr key={e.id} className="hover:bg-muted/20">
                          <td className="px-3 py-2.5">
                            <p className="text-xs font-medium text-foreground">{name}</p>
                            {partner && (
                              <p className="text-[11px] capitalize text-muted-foreground">
                                {partner.status}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {completedTracks.length === 0 ? (
                              <span className="text-[11px] text-muted-foreground/50">None</span>
                            ) : (
                              <div className="space-y-0.5">
                                {completedTracks.map((t) => (
                                  <span
                                    key={t}
                                    className="block text-[11px] text-muted-foreground"
                                  >
                                    {TRACK_LABELS[t] ?? t}
                                  </span>
                                ))}
                              </div>
                            )}
                            {meetsReq && e.status !== "approved" && (
                              <span className="mt-0.5 block text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                ✓ Meets requirement
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <EligibilityBadge status={e.status} />
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {e.status !== "approved" && (
                                <button
                                  type="button"
                                  onClick={() => handleAction(e, "approved")}
                                  className="rounded px-2 py-0.5 text-[11px] font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300"
                                >
                                  Approve
                                </button>
                              )}
                              {e.status !== "pending" && (
                                <button
                                  type="button"
                                  onClick={() => handleAction(e, "pending")}
                                  className="rounded px-2 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300"
                                >
                                  Pending
                                </button>
                              )}
                              {e.status !== "denied" && e.status !== "revoked" && (
                                <button
                                  type="button"
                                  onClick={() => handleAction(e, "revoked")}
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
        </div>

        {/* Toast */}
        {toastMsg && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-xl border bg-card px-4 py-2.5 shadow-lg">
            <p className="text-xs font-medium text-foreground">{toastMsg}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk tools modal
// ---------------------------------------------------------------------------

interface BulkToolsModalProps {
  products: Product[];
  partners: PartnerProfile[];
  eligibilities: ProductEligibility[];
  agencyId: string;
  uid: string;
  onClose: () => void;
}

function BulkToolsModal({ products, partners, eligibilities, agencyId, uid, onClose }: BulkToolsModalProps) {
  const [running, setRunning] = useState<"generate" | "approve" | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // Compute what each action would do
  const activeProducts = useMemo(
    () => products.filter((p) => p.status !== "archived"),
    [products],
  );
  const activePartners = useMemo(
    () => partners.filter((p) => p.status === "active" || p.status === "approved"),
    [partners],
  );
  const eligibilitySet = useMemo(
    () => new Set(eligibilities.map((e) => `${e.partnerProfileId}_${e.productId}`)),
    [eligibilities],
  );

  // Missing rows: all active partner × product combos without a row
  const missingCombos = useMemo(() => {
    const combos: { partner: PartnerProfile; product: Product }[] = [];
    for (const partner of activePartners) {
      for (const product of activeProducts) {
        if (!eligibilitySet.has(`${partner.id}_${product.id}`)) {
          combos.push({ partner, product });
        }
      }
    }
    return combos;
  }, [activePartners, activeProducts, eligibilitySet]);

  // Auto-approvable: pending rows where partner meets product requirement
  const autoApprovable = useMemo(() => {
    const partnerMap = new Map(partners.map((p) => [p.id, p]));
    return eligibilities.filter((e) => {
      if (e.status !== "pending") return false;
      const partner = partnerMap.get(e.partnerProfileId);
      if (!partner) return false;
      const product = products.find((p) => p.id === e.productId);
      if (!product) return false;
      const req = effectiveRequirement(product);
      if (req === "manual_approval") return false;
      return partnerMeetsRequirement(partner.completedTrackIds ?? [], req);
    });
  }, [eligibilities, partners, products]);

  async function handleGenerateMissing() {
    if (missingCombos.length === 0) return;
    setRunning("generate");
    setResult(null);
    try {
      const db = getFirebaseDb();
      // Split into chunks of 400 (Firestore batch limit is 500)
      const chunks: typeof missingCombos[] = [];
      for (let i = 0; i < missingCombos.length; i += 400) {
        chunks.push(missingCombos.slice(i, i + 400));
      }
      let total = 0;
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        for (const { partner, product } of chunk) {
          const docId = eligibilityDocId(partner.id, product.id);
          const ref = doc(db, "product_eligibility", docId);
          batch.set(ref, {
            id: docId,
            agencyId,
            partnerProfileId: partner.id,
            productId: product.id,
            status: "pending",
            accessModel: product.accessModel,
            stripeSubscriptionId: null,
            byokKey: null,
            byokKeyLast4: null,
            byokKeyValidatedAt: null,
            reviewedByUid: null,
            reviewedAt: null,
            reviewNote: null,
            expiresAt: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true });
          total++;
        }
        await batch.commit();
      }
      setResult(`✅ Created ${total} missing eligibility row${total !== 1 ? "s" : ""} with status "pending".`);
    } catch (err) {
      setResult(`❌ Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setRunning(null);
    }
  }

  async function handleAutoApprove() {
    if (autoApprovable.length === 0) return;
    setRunning("approve");
    setResult(null);
    try {
      // Use individual updateProductEligibility calls (they do updateDoc internally)
      // Split into parallel groups of 50 to avoid overwhelming Firestore
      const chunks: typeof autoApprovable[] = [];
      for (let i = 0; i < autoApprovable.length; i += 50) {
        chunks.push(autoApprovable.slice(i, i + 50));
      }
      let total = 0;
      for (const chunk of chunks) {
        await Promise.all(
          chunk.map((e) =>
            updateProductEligibility(e.partnerProfileId, e.productId, {
              status: "approved",
              reviewedByUid: uid,
            }),
          ),
        );
        total += chunk.length;
      }
      setResult(`✅ Approved ${total} partner eligibility row${total !== 1 ? "s" : ""}.`);
    } catch (err) {
      setResult(`❌ Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md rounded-xl border bg-background p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Bulk Tools</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Generate missing rows */}
          <div className="rounded-xl border p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground">Generate missing rows</h3>
              <span className={cn(
                "rounded-md px-2 py-0.5 text-[11px] tabular-nums font-medium",
                missingCombos.length > 0
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                  : "bg-muted text-muted-foreground",
              )}>
                {missingCombos.length} missing
              </span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Creates a <strong>pending</strong> eligibility row for every active partner × active
              product combination that has no row yet. Does not overwrite existing rows.
            </p>
            <button
              type="button"
              disabled={missingCombos.length === 0 || running !== null}
              onClick={handleGenerateMissing}
              className="w-full rounded-lg border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running === "generate"
                ? "Generating…"
                : `Generate ${missingCombos.length} row${missingCombos.length !== 1 ? "s" : ""}`}
            </button>
          </div>

          {/* Auto-approve by tracks */}
          <div className="rounded-xl border p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground">Auto-approve eligible partners</h3>
              <span className={cn(
                "rounded-md px-2 py-0.5 text-[11px] tabular-nums font-medium",
                autoApprovable.length > 0
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground",
              )}>
                {autoApprovable.length} eligible
              </span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Approves pending rows where the partner already meets the product's track
              requirement. Products set to <strong>manual approval</strong> are never
              auto-approved regardless.
            </p>
            <button
              type="button"
              disabled={autoApprovable.length === 0 || running !== null}
              onClick={handleAutoApprove}
              className="w-full rounded-lg border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running === "approve"
                ? "Approving…"
                : `Approve ${autoApprovable.length} row${autoApprovable.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>

        {result && (
          <p className="mt-4 rounded-lg border bg-muted/40 px-3 py-2.5 text-xs text-foreground">
            {result}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AgencyProductEligibilityPage() {
  const { agencyId, agencyRole, user } = useAuth();
  const isOwner = agencyRole === "owner";

  const [products, setProducts] = useState<Product[]>([]);
  const [partners, setPartners] = useState<PartnerProfile[]>([]);
  const [eligibilities, setEligibilities] = useState<ProductEligibility[]>([]);
  const [loading, setLoading] = useState(true);

  const [managingProduct, setManagingProduct] = useState<Product | null>(null);
  const [showBulk, setShowBulk] = useState(false);

  useEffect(() => {
    if (!agencyId || !isOwner) { setLoading(false); return; }

    let done = 0;
    const check = () => { if (++done === 3) setLoading(false); };

    const u1 = subscribeToProducts(agencyId, (d) => { setProducts(d); check(); }, () => check());
    const u2 = subscribeToPartnerProfiles(agencyId, (d) => { setPartners(d); check(); }, () => check());
    const u3 = subscribeToAgencyEligibilities(agencyId, (d) => { setEligibilities(d); check(); }, () => check());

    return () => { u1(); u2(); u3(); };
  }, [agencyId, isOwner]);

  // Approved count per product
  const approvedCountByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of eligibilities) {
      if (e.status === "approved") {
        map.set(e.productId, (map.get(e.productId) ?? 0) + 1);
      }
    }
    return map;
  }, [eligibilities]);

  // Missing rows count per product (active partners without any eligibility row for that product)
  const activePartnerIds = useMemo(
    () => new Set(partners.filter((p) => p.status === "active" || p.status === "approved").map((p) => p.id)),
    [partners],
  );
  const coveredByProduct = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of eligibilities) {
      if (!map.has(e.productId)) map.set(e.productId, new Set());
      map.get(e.productId)!.add(e.partnerProfileId);
    }
    return map;
  }, [eligibilities]);

  function missingCountForProduct(productId: string): number {
    const covered = coveredByProduct.get(productId) ?? new Set();
    let count = 0;
    for (const pid of activePartnerIds) {
      if (!covered.has(pid)) count++;
    }
    return count;
  }

  // Sort: active first, then draft, then archived; alphabetical within each group
  const sortedProducts = useMemo(
    () =>
      [...products].sort((a, b) => {
        const order = ["active", "draft", "archived"];
        const ao = order.indexOf(a.status);
        const bo = order.indexOf(b.status);
        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name);
      }),
    [products],
  );

  if (!isOwner) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <ShieldCheck className="h-10 w-10 text-muted-foreground/40" />
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
            <ShieldCheck className="h-4 w-4" />
            <span className="text-sm font-medium uppercase tracking-wider">Revenue OS — Agency</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Product Eligibility</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Control which partners can sell or earn from each product.
            Public visibility and partner eligibility are independent.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowBulk(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Zap className="h-4 w-4" />
          Bulk tools
        </button>
      </div>

      {/* Summary row */}
      {!loading && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Products</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {products.filter((p) => p.status !== "archived").length}
            </p>
            <p className="text-xs text-muted-foreground">active or draft</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Active partners</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{activePartnerIds.size}</p>
            <p className="text-xs text-muted-foreground">active or approved</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Approved rows</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {eligibilities.filter((e) => e.status === "approved").length}
            </p>
            <p className="text-xs text-muted-foreground">
              {eligibilities.filter((e) => e.status === "pending").length} pending
            </p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      )}

      {/* Product eligibility table */}
      {!loading && sortedProducts.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-16 text-center">
          <Package className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No products found. Create products in{" "}
            <a href="/agency/products" className="text-primary underline underline-offset-2">
              Agency → Products
            </a>{" "}
            first.
          </p>
        </div>
      )}

      {!loading && sortedProducts.length > 0 && (
        <div className="rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Public</th>
                  <th className="px-4 py-3 font-medium">Commission</th>
                  <th className="px-4 py-3 font-medium">Sell requirement</th>
                  <th className="px-4 py-3 font-medium">Approved</th>
                  <th className="px-4 py-3 font-medium">Missing rows</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sortedProducts.map((p) => {
                  const req = effectiveRequirement(p);
                  const approvedCount = approvedCountByProduct.get(p.id) ?? 0;
                  const missing = p.status === "archived" ? 0 : missingCountForProduct(p.id);
                  const isCommissionable = p.isCommissionable !== false;
                  return (
                    <tr
                      key={p.id}
                      className={cn("hover:bg-muted/20", p.status === "archived" && "opacity-60")}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{p.name}</p>
                        {p.productFamily && (
                          <p className="text-[11px] capitalize text-muted-foreground">
                            {p.productFamily.replace(/_/g, " ")}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          p.status === "active"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : p.status === "draft"
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
                        )}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {p.isPublic ? (
                          <span className="text-emerald-600 dark:text-emerald-400">Public</span>
                        ) : (
                          <span>Hidden</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          isCommissionable
                            ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
                        )}>
                          {isCommissionable ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <RequirementBadge req={req} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <BadgeCheck className="h-3.5 w-3.5 text-emerald-500" />
                          <span className="tabular-nums text-xs text-foreground">{approvedCount}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {missing > 0 ? (
                          <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3" />
                            {missing}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setManagingProduct(p)}
                          className="rounded-lg border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manage panel */}
      {managingProduct && (
        <ManagePanel
          product={managingProduct}
          partners={partners}
          eligibilities={eligibilities}
          uid={user?.uid ?? ""}
          agencyId={agencyId ?? ""}
          onClose={() => setManagingProduct(null)}
        />
      )}

      {/* Bulk tools modal */}
      {showBulk && (
        <BulkToolsModal
          products={products}
          partners={partners}
          eligibilities={eligibilities}
          agencyId={agencyId ?? ""}
          uid={user?.uid ?? ""}
          onClose={() => setShowBulk(false)}
        />
      )}
    </div>
  );
}
