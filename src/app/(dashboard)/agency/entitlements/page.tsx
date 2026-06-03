"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Link2,
  Package,
  RotateCcw,
  ShieldOff,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { subscribeToAgencyEntitlements } from "@/lib/firestore/entitlements";
import { subscribeToAgencyPurchases } from "@/lib/firestore/marketplace-purchases";
import type { ProductEntitlement } from "@/types/products";
import type { MarketplacePurchase } from "@/types/marketplace";
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

const FAMILY_LABELS: Record<string, string> = {
  ugotleads_software: "uGotLeads Software",
  myusa_education: "MyUSA Education",
  myusa_services: "MyUSA Services",
  myusa_resources: "MyUSA Resources",
  myusa_media_products: "MyUSA Media",
};

type FilterKey =
  | "all"
  | "active"
  | "revoked"
  | "has_purchase"
  | "missing_purchase"
  | string; // productFamily values

// ---------------------------------------------------------------------------
// Manage modal
// ---------------------------------------------------------------------------

function ManageModal({
  entitlement,
  onClose,
  onDone,
}: {
  entitlement: ProductEntitlement;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [note, setNote] = useState(entitlement.internalNote ?? "");
  const [saving, setSaving] = useState<"revoke" | "reactivate" | "note" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "revoke" | "reactivate" | "note") {
    setSaving(action);
    setError(null);
    try {
      const res = await fetch("/api/agency/entitlements/manage", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entitlementId: entitlement.id,
          action,
          internalNote: note.trim() || null,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Action failed.");
      } else {
        onDone(
          action === "revoke"
            ? "Entitlement revoked."
            : action === "reactivate"
              ? "Entitlement reactivated."
              : "Note saved.",
        );
        onClose();
      }
    } catch {
      setError("Network error.");
    } finally {
      setSaving(null);
    }
  }

  const isActive = entitlement.status === "active";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md rounded-xl border bg-background p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Manage entitlement</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 rounded-lg bg-muted/40 px-3 py-2.5 text-xs">
          <p className="font-medium text-foreground">{entitlement.productName}</p>
          <p className="text-muted-foreground">Customer: {entitlement.customerUserId}</p>
          <p className="text-muted-foreground">
            Status: <span className="capitalize">{entitlement.status}</span>
          </p>
        </div>

        {/* Internal note */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Internal note (agency-only)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="e.g. Refunded on 2026-06-01 — revoked access."
            className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={saving !== null}
            onClick={() => run("note")}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-60"
          >
            {saving === "note" ? "Saving…" : "Save note"}
          </button>
          {isActive ? (
            <button
              type="button"
              disabled={saving !== null}
              onClick={() => run("revoke")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              <ShieldOff className="h-3.5 w-3.5" />
              {saving === "revoke" ? "Revoking…" : "Revoke access"}
            </button>
          ) : (
            <button
              type="button"
              disabled={saving !== null}
              onClick={() => run("reactivate")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {saving === "reactivate" ? "Reactivating…" : "Reactivate"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgencyEntitlementsPage() {
  const { agencyId, agencyRole } = useAuth();
  const isOwner = agencyRole === "owner";

  const [entitlements, setEntitlements] = useState<ProductEntitlement[]>([]);
  const [purchases, setPurchases] = useState<MarketplacePurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [managing, setManaging] = useState<ProductEntitlement | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!agencyId || !isOwner) {
      setLoading(false);
      return;
    }
    let done = 0;
    const check = () => { if (++done === 2) setLoading(false); };
    const u1 = subscribeToAgencyEntitlements(agencyId, (d) => { setEntitlements(d); check(); }, () => check());
    const u2 = subscribeToAgencyPurchases(agencyId, (d) => { setPurchases(d); check(); }, () => check());
    return () => { u1(); u2(); };
  }, [agencyId, isOwner]);

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  }

  const purchaseBySession = useMemo(
    () => new Map(purchases.map((p) => [p.stripeSessionId, p])),
    [purchases],
  );

  const presentFamilies = useMemo(
    () =>
      Array.from(
        new Set(entitlements.map((e) => e.productFamily).filter((f): f is NonNullable<typeof f> => f !== null)),
      ).sort(),
    [entitlements],
  );

  const filtered = useMemo(() => {
    let list = entitlements;
    switch (filter) {
      case "all": break;
      case "active": list = list.filter((e) => e.status === "active"); break;
      case "revoked": list = list.filter((e) => e.status === "revoked"); break;
      case "has_purchase": list = list.filter((e) => !!e.grantingSessionId && purchaseBySession.has(e.grantingSessionId)); break;
      case "missing_purchase": list = list.filter((e) => !e.grantingSessionId || !purchaseBySession.has(e.grantingSessionId)); break;
      default: list = list.filter((e) => e.productFamily === filter); break;
    }
    return [...list].sort((a, b) => {
      // active first, then by grantedAt desc
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      const ad = (a.grantedAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
      const bd = (b.grantedAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
      return bd - ad;
    });
  }, [entitlements, filter, purchaseBySession]);

  const counts = useMemo(() => ({
    all: entitlements.length,
    active: entitlements.filter((e) => e.status === "active").length,
    revoked: entitlements.filter((e) => e.status === "revoked").length,
  }), [entitlements]);

  if (!isOwner) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <Package className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground">Agency owner access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-6 p-6">
      {/* Header */}
      <div>
        <div className="mb-1 flex items-center gap-2 text-muted-foreground">
          <Package className="h-4 w-4" />
          <span className="text-sm font-medium uppercase tracking-wider">Revenue OS — Agency</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Entitlements</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Customer product access across your agency. Revoke or reactivate access here.
        </p>
      </div>

      {/* Summary */}
      {!loading && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Active</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{counts.active}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Revoked</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{counts.revoked}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Total</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{counts.all}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {([
          { k: "all", label: "All" },
          { k: "active", label: "Active" },
          { k: "revoked", label: "Revoked" },
          { k: "has_purchase", label: "Has purchase" },
          { k: "missing_purchase", label: "Missing purchase" },
        ] as { k: FilterKey; label: string }[]).map((f) => (
          <button
            key={f.k}
            type="button"
            onClick={() => setFilter(f.k)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              filter === f.k
                ? "bg-primary text-primary-foreground"
                : "border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
        {presentFamilies.length > 0 && <span className="mx-1 text-muted-foreground/30">|</span>}
        {presentFamilies.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(filter === f ? "all" : f)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              filter === f
                ? "bg-primary text-primary-foreground"
                : "border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {FAMILY_LABELS[f] ?? f}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <Package className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {entitlements.length === 0 ? "No entitlements yet." : "No entitlements match this filter."}
          </p>
        </div>
      )}

      {/* Table */}
      {!loading && filtered.length > 0 && (
        <div className="rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Sub-account</th>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Granted</th>
                  <th className="px-4 py-3 font-medium">Purchase</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((e) => {
                  const purchase = e.grantingSessionId ? purchaseBySession.get(e.grantingSessionId) : undefined;
                  return (
                    <tr key={e.id} className={cn("hover:bg-muted/20", e.status === "revoked" && "opacity-60")}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{e.productName}</p>
                        {e.productFamily && (
                          <p className="text-[11px] text-muted-foreground">
                            {FAMILY_LABELS[e.productFamily] ?? e.productFamily}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                          {e.customerUserId.slice(0, 10)}…
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                          {e.subAccountId ?? "—"}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {e.accessModel}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          e.status === "active"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
                        )}>
                          {e.status === "active" && <CheckCircle2 className="h-2.5 w-2.5" />}
                          {e.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(e.grantedAt)}</td>
                      <td className="px-4 py-3">
                        {purchase ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                            <Link2 className="h-3 w-3" />
                            Linked
                          </span>
                        ) : (
                          <span className="text-[11px] text-amber-600 dark:text-amber-400">No link</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setManaging(e)}
                          className="rounded-lg border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
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

      {managing && (
        <ManageModal
          entitlement={managing}
          onClose={() => setManaging(null)}
          onDone={showToast}
        />
      )}

      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border bg-card px-4 py-3 shadow-lg">
          <p className="text-sm font-medium text-foreground">{toastMsg}</p>
        </div>
      )}
    </div>
  );
}
