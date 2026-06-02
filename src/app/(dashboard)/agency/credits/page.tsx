"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Coins,
  Plus,
  Minus,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  subscribeToAgencyWallets,
  createCreditWallet,
  subscribeToCreditTransactions,
} from "@/lib/firestore/credits";
import { subscribeToPartnerProfiles } from "@/lib/firestore/partners";
import type { CreditWallet, CreditTransaction, CreditTxnType } from "@/types/credits";
import type { PartnerProfile } from "@/types/partner";
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

const ADJUSTABLE_TYPES: { value: CreditTxnType; label: string; hint: string }[] = [
  { value: "purchase", label: "Purchase", hint: "Credits bought by the partner" },
  { value: "adjustment", label: "Manual adjustment", hint: "Admin correction or bonus" },
  { value: "refund", label: "Refund", hint: "Returning previously spent credits" },
];

// ---------------------------------------------------------------------------
// Adjust balance modal
// ---------------------------------------------------------------------------

interface AdjustModalProps {
  partner: PartnerProfile;
  wallet: CreditWallet | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

function AdjustModal({ partner, wallet, onClose, onSuccess }: AdjustModalProps) {
  const [delta, setDelta] = useState("");
  const [type, setType] = useState<CreditTxnType>("adjustment");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentBalance = wallet?.balanceCredits ?? 0;
  const deltaNum = Number(delta) || 0;
  const previewBalance = Math.max(0, currentBalance + deltaNum);

  async function handleSubmit() {
    if (!delta || deltaNum === 0) { setError("Enter a non-zero delta."); return; }
    if (!description.trim()) { setError("Description is required."); return; }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/credits/adjust", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerProfileId: partner.id,
          delta: deltaNum,
          type,
          description: description.trim(),
        }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; note?: string; newBalance?: number };
      if (!res.ok) {
        setError(data.error ?? "Adjustment failed.");
      } else {
        onSuccess(`Balance updated to ${data.newBalance?.toLocaleString() ?? previewBalance.toLocaleString()} credits.`);
        onClose();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-sm rounded-xl border bg-background p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Adjust credit balance</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 rounded-lg bg-muted/40 px-3 py-2.5">
          <p className="text-xs text-muted-foreground">
            Partner: <strong className="text-foreground">{partner.displayName ?? partner.fullName}</strong>
          </p>
          <p className="text-xs text-muted-foreground">
            Current balance: <strong className="text-foreground tabular-nums">{currentBalance.toLocaleString()} credits</strong>
          </p>
        </div>

        <div className="space-y-3">
          {/* Delta input */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Delta (positive = add, negative = deduct)
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDelta((v) => String((Number(v) || 0) - 100))}
                className="rounded-lg border p-2 text-muted-foreground hover:bg-muted"
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                type="number"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                placeholder="e.g. 500 or -100"
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={() => setDelta((v) => String((Number(v) || 0) + 100))}
                className="rounded-lg border p-2 text-muted-foreground hover:bg-muted"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {deltaNum !== 0 && (
              <p className={cn("mt-1 text-[11px] font-medium", previewBalance < currentBalance ? "text-amber-600" : "text-emerald-600")}>
                New balance: {previewBalance.toLocaleString()} credits
                {previewBalance === 0 && currentBalance + deltaNum < 0 && (
                  <span className="ml-1 text-muted-foreground">(clamped at 0)</span>
                )}
              </p>
            )}
          </div>

          {/* Type */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Type</label>
            <div className="relative">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as CreditTxnType)}
                className="w-full appearance-none rounded-lg border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {ADJUSTABLE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {ADJUSTABLE_TYPES.find((t) => t.value === type)?.hint}
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Description <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="e.g. Bonus credits for June referral milestone"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
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
            disabled={saving || !delta || deltaNum === 0}
            onClick={handleSubmit}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? "Applying…" : "Apply adjustment"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transaction history drawer (per partner)
// ---------------------------------------------------------------------------

function TransactionDrawer({
  partner,
  onClose,
}: {
  partner: PartnerProfile;
  onClose: () => void;
}) {
  const [txns, setTxns] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeToCreditTransactions(
      partner.id,
      (data) => { setTxns(data); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, [partner.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-hidden border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Transaction history</h2>
            <p className="text-xs text-muted-foreground">{partner.displayName ?? partner.fullName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/40" />
              ))}
            </div>
          ) : txns.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            <div className="space-y-1">
              {txns.map((txn) => (
                <div key={txn.id} className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-muted/20">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-foreground">{txn.description}</p>
                    <p className="text-[11px] text-muted-foreground capitalize">{txn.type} · {fmtDate(txn.createdAt)}</p>
                  </div>
                  <div className="ml-3 text-right">
                    <p className={cn(
                      "font-mono text-xs font-medium tabular-nums",
                      txn.delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
                    )}>
                      {txn.delta >= 0 ? "+" : ""}{txn.delta.toLocaleString()}
                    </p>
                    <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      → {txn.balanceAfter.toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AgencyCreditsPage() {
  const { agencyId, agencyRole, user } = useAuth();
  const isOwner = agencyRole === "owner";

  const [wallets, setWallets] = useState<CreditWallet[]>([]);
  const [partners, setPartners] = useState<PartnerProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [adjustingPartner, setAdjustingPartner] = useState<PartnerProfile | null>(null);
  const [viewingPartner, setViewingPartner] = useState<PartnerProfile | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [initializingId, setInitializingId] = useState<string | null>(null);

  useEffect(() => {
    if (!agencyId || !isOwner) { setLoading(false); return; }
    let done = 0;
    const check = () => { if (++done === 2) setLoading(false); };
    const u1 = subscribeToAgencyWallets(agencyId, (d) => { setWallets(d); check(); }, () => check());
    const u2 = subscribeToPartnerProfiles(agencyId, (d) => { setPartners(d); check(); }, () => check());
    return () => { u1(); u2(); };
  }, [agencyId, isOwner]);

  const walletMap = useMemo(() => new Map(wallets.map((w) => [w.partnerProfileId, w])), [wallets]);
  const activePartners = useMemo(
    () => partners.filter((p) => p.status === "active" || p.status === "approved"),
    [partners],
  );

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  }

  async function handleInitializeWallet(partner: PartnerProfile) {
    if (!agencyId) return;
    setInitializingId(partner.id);
    try {
      await createCreditWallet({
        agencyId,
        partnerProfileId: partner.id,
        subAccountId: partner.subAccountId,
        stripeCustomerId: null,
      });
      showToast(`Wallet initialized for ${partner.displayName ?? partner.fullName}.`);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setInitializingId(null);
    }
  }

  const totalCreditsInCirculation = useMemo(
    () => wallets.reduce((s, w) => s + w.balanceCredits, 0),
    [wallets],
  );

  if (!isOwner) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <Coins className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground">Agency owner access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-6 p-6">
      {/* Header */}
      <div>
        <div className="mb-1 flex items-center gap-2 text-muted-foreground">
          <Coins className="h-4 w-4" />
          <span className="text-sm font-medium uppercase tracking-wider">Revenue OS — Agency</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Credit Wallets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage partner credit balances and view transaction history.
        </p>
      </div>

      {/* Summary cards */}
      {!loading && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Wallets active</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{wallets.length}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Credits in circulation</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{totalCreditsInCirculation.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Partners without wallet</p>
            <p className={cn("text-2xl font-bold tabular-nums", activePartners.filter((p) => !walletMap.has(p.id)).length > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
              {activePartners.filter((p) => !walletMap.has(p.id)).length}
            </p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      )}

      {/* Partners table */}
      {!loading && activePartners.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
          <Coins className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No active partners yet.</p>
        </div>
      )}

      {!loading && activePartners.length > 0 && (
        <div className="rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Partner</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Balance</th>
                  <th className="px-4 py-3 font-medium">Lifetime purchased</th>
                  <th className="px-4 py-3 font-medium">Lifetime spent</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {activePartners.map((partner) => {
                  const wallet = walletMap.get(partner.id) ?? null;
                  const isInitializing = initializingId === partner.id;
                  return (
                    <tr key={partner.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{partner.displayName ?? partner.fullName}</p>
                        <p className="text-xs text-muted-foreground">{partner.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          partner.status === "active"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
                        )}>
                          {partner.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {wallet ? (
                          <span className="tabular-nums text-sm font-semibold text-violet-700 dark:text-violet-300">
                            {wallet.balanceCredits.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">No wallet</span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-xs text-muted-foreground">
                        {wallet ? wallet.lifetimePurchasedCredits.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-xs text-muted-foreground">
                        {wallet ? wallet.lifetimeSpentCredits.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {!wallet ? (
                            <button
                              type="button"
                              disabled={isInitializing}
                              onClick={() => handleInitializeWallet(partner)}
                              className="rounded-lg border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
                            >
                              {isInitializing ? "Creating…" : "Initialize"}
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setAdjustingPartner(partner)}
                                className="rounded-lg border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                Adjust
                              </button>
                              <button
                                type="button"
                                onClick={() => setViewingPartner(partner)}
                                className="rounded-lg border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                History
                              </button>
                            </>
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

      {/* Adjust modal */}
      {adjustingPartner && (
        <AdjustModal
          partner={adjustingPartner}
          wallet={walletMap.get(adjustingPartner.id) ?? null}
          onClose={() => setAdjustingPartner(null)}
          onSuccess={(msg) => { showToast(msg); setAdjustingPartner(null); }}
        />
      )}

      {/* Transaction history drawer */}
      {viewingPartner && (
        <TransactionDrawer
          partner={viewingPartner}
          onClose={() => setViewingPartner(null)}
        />
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
