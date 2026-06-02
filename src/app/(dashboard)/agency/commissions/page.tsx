"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { subscribeToAgencyCommissionEvents } from "@/lib/firestore/commission";
import { subscribeToCommissionRules } from "@/lib/firestore/commission";
import { subscribeToPartnerProfiles } from "@/lib/firestore/partners";
import type { CommissionEvent, CommissionRule, CommissionStatus } from "@/types/credits";
import type { PartnerProfile } from "@/types/partner";
import { cn } from "@/lib/utils";

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

function tsToDate(val: unknown): Date | null {
  if (!val) return null;
  if (val && typeof val === "object" && "toDate" in val) {
    return (val as { toDate: () => Date }).toDate();
  }
  if (val instanceof Date) return val;
  return null;
}

function formatDate(val: unknown): string {
  const d = tsToDate(val);
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const TRIGGER_LABELS: Record<string, string> = {
  partner_referral: "Referral",
  product_sale: "Product sale",
  subscription_renewal: "Renewal",
};

const STATUS_STYLES: Record<CommissionStatus, string> = {
  pending:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  voided:
    "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const STATUS_ICONS: Record<CommissionStatus, typeof Circle> = {
  pending: Circle,
  paid: CheckCircle2,
  voided: XCircle,
};

type FilterTab = "all" | CommissionStatus;

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "paid", label: "Paid" },
  { key: "voided", label: "Voided" },
];

// ---------------------------------------------------------------------------
// Inline action dialogs (minimal, no external modal library)
// ---------------------------------------------------------------------------

interface ActionState {
  eventId: string;
  action: "mark_paid" | "void";
  note: string;
  saving: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CommissionDashboardPage() {
  const { agencyId, agencyRole } = useAuth();
  const isOwner = agencyRole === "owner";

  // ---- Data ----
  const [events, setEvents] = useState<CommissionEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);

  const [partnerMap, setPartnerMap] = useState<Map<string, PartnerProfile>>(
    new Map(),
  );
  const [partnersLoading, setPartnersLoading] = useState(true);

  // ---- UI ----
  const [activeTab, setActiveTab] = useState<FilterTab>("pending");
  const [actionState, setActionState] = useState<ActionState | null>(null);
  const [expandedRules, setExpandedRules] = useState(false);

  useEffect(() => {
    if (!agencyId) return;
    const unsub = subscribeToAgencyCommissionEvents(
      agencyId,
      (e) => { setEvents(e); setEventsLoading(false); },
      (err) => { console.error("[commissions]", err); setEventsLoading(false); },
    );
    return () => unsub();
  }, [agencyId]);

  useEffect(() => {
    if (!agencyId) return;
    const unsub = subscribeToCommissionRules(
      agencyId,
      (r) => { setRules(r); setRulesLoading(false); },
      (err) => { console.error("[commissions rules]", err); setRulesLoading(false); },
    );
    return () => unsub();
  }, [agencyId]);

  useEffect(() => {
    if (!agencyId) return;
    const unsub = subscribeToPartnerProfiles(
      agencyId,
      (profiles) => {
        const m = new Map<string, PartnerProfile>();
        for (const p of profiles) m.set(p.id, p);
        setPartnerMap(m);
        setPartnersLoading(false);
      },
      (err) => { console.error("[commissions partners]", err); setPartnersLoading(false); },
    );
    return () => unsub();
  }, [agencyId]);

  // ---- Derived KPIs ----
  const pending = useMemo(() => events.filter((e) => e.status === "pending"), [events]);
  const paid = useMemo(() => events.filter((e) => e.status === "paid"), [events]);
  const voided = useMemo(() => events.filter((e) => e.status === "voided"), [events]);

  const totalPendingCents = useMemo(
    () => pending.reduce((sum, e) => sum + e.commissionCents, 0),
    [pending],
  );
  const totalPaidCents = useMemo(
    () => paid.reduce((sum, e) => sum + e.commissionCents, 0),
    [paid],
  );

  const activeRules = useMemo(() => rules.filter((r) => r.isActive), [rules]);

  // ---- Filtered events ----
  const filtered = useMemo(() => {
    if (activeTab === "all") return events;
    if (activeTab === "pending") return pending;
    if (activeTab === "paid") return paid;
    return voided;
  }, [activeTab, events, pending, paid, voided]);

  const counts: Record<FilterTab, number> = {
    all: events.length,
    pending: pending.length,
    paid: paid.length,
    voided: voided.length,
  };

  const loading = eventsLoading || rulesLoading || partnersLoading;

  // ---- Action handler ----
  async function handleAction() {
    if (!actionState) return;
    setActionState((s) => s && { ...s, saving: true, error: null });

    const body: Record<string, string> = { action: actionState.action };
    if (actionState.action === "mark_paid" && actionState.note)
      body.note = actionState.note;
    if (actionState.action === "void" && actionState.note)
      body.reason = actionState.note;

    const res = await fetch(
      `/api/agency/commissions/${actionState.eventId}`,
      {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setActionState((s) =>
        s && { ...s, saving: false, error: data.error ?? `HTTP ${res.status}` },
      );
      return;
    }

    setActionState(null);
  }

  // ---- Unauthorised guard ----
  if (!loading && !isOwner) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          Agency owner access required to view commissions.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-8 p-6">
      {/* ---- Header ---- */}
      <div>
        <div className="mb-1 flex items-center gap-2 text-muted-foreground">
          <BadgeDollarSign className="h-4 w-4" />
          <span className="text-sm font-medium uppercase tracking-wider">
            Revenue OS
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Commission Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track partner commissions, mark payouts, and manage commission rules.
        </p>
      </div>

      {/* ---- KPI row ---- */}
      {!loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Pending Payouts
            </p>
            <p className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {formatCents(totalPendingCents)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {pending.length} event{pending.length !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Total Paid Out
            </p>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {formatCents(totalPaidCents)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {paid.length} payout{paid.length !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Active Partners
            </p>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {
                Array.from(partnerMap.values()).filter(
                  (p) => p.status === "active" || p.status === "approved",
                ).length
              }
            </p>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Active Rules
            </p>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {activeRules.length}
            </p>
          </div>
        </div>
      )}

      {/* ---- Loading skeleton ---- */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      )}

      {/* ---- Commission events ---- */}
      <section className="space-y-3">
        {/* Filter tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                activeTab === tab.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                  activeTab === tab.key
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {counts[tab.key]}
              </span>
            </button>
          ))}
        </div>

        {/* Table */}
        {!loading && filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
            <BadgeDollarSign className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              No{activeTab !== "all" ? ` ${activeTab}` : ""} commission events yet.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30">
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Partner</th>
                  <th className="px-4 py-3 font-medium">Trigger</th>
                  <th className="px-4 py-3 font-medium text-right">Gross</th>
                  <th className="px-4 py-3 font-medium text-right">Rate</th>
                  <th className="px-4 py-3 font-medium text-right">Commission</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  {isOwner && (
                    <th className="px-4 py-3 font-medium">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((event) => {
                  const partner = partnerMap.get(event.partnerProfileId);
                  const partnerName =
                    partner?.displayName ?? partner?.fullName ?? event.partnerProfileId.slice(0, 8) + "…";
                  const StatusIcon = STATUS_ICONS[event.status];

                  return (
                    <tr key={event.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-foreground">
                          {partnerName}
                        </div>
                        {partner?.email && (
                          <div className="text-xs text-muted-foreground">
                            {partner.email}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {TRIGGER_LABELS[event.trigger] ?? event.trigger}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums">
                        {formatCents(event.grossAmountCents)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-muted-foreground">
                        {event.commissionPct}%
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums">
                        {formatCents(event.commissionCents)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            STATUS_STYLES[event.status],
                          )}
                        >
                          <StatusIcon className="h-2.5 w-2.5" />
                          {event.status}
                        </span>
                        {event.status === "paid" && event.paidOutNote && (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {event.paidOutNote}
                          </p>
                        )}
                        {event.status === "voided" && event.voidReason && (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {event.voidReason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDate(event.createdAt)}
                      </td>
                      {isOwner && (
                        <td className="px-4 py-3">
                          {event.status === "pending" && (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setActionState({
                                    eventId: event.id,
                                    action: "mark_paid",
                                    note: "",
                                    saving: false,
                                    error: null,
                                  })
                                }
                                className="rounded-md bg-emerald-100 px-2 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                              >
                                Mark paid
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setActionState({
                                    eventId: event.id,
                                    action: "void",
                                    note: "",
                                    saving: false,
                                    error: null,
                                  })
                                }
                                className="rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                              >
                                Void
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- Commission rules summary ---- */}
      {!loading && (
        <section className="rounded-xl border bg-card">
          <button
            type="button"
            onClick={() => setExpandedRules((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                Commission Rules
              </h2>
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                {activeRules.length} active / {rules.length} total
              </span>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                expandedRules && "rotate-180",
              )}
            />
          </button>

          {expandedRules && (
            <div className="border-t px-5 pb-5 pt-4">
              {rules.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No commission rules configured yet. Rules are seeded by the
                  Revenue OS seeder.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">Name</th>
                        <th className="pb-2 pr-4 font-medium">Trigger</th>
                        <th className="pb-2 pr-4 font-medium">Product</th>
                        <th className="pb-2 pr-4 font-medium">Tier</th>
                        <th className="pb-2 pr-4 font-medium text-right">Rate</th>
                        <th className="pb-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rules.map((rule) => (
                        <tr key={rule.id} className="text-xs">
                          <td className="py-2 pr-4 font-medium text-foreground">
                            {rule.name}
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground">
                            {TRIGGER_LABELS[rule.trigger] ?? rule.trigger}
                          </td>
                          <td className="py-2 pr-4 font-mono text-muted-foreground">
                            {rule.productId ?? <span className="italic">All products</span>}
                          </td>
                          <td className="py-2 pr-4 capitalize text-muted-foreground">
                            {rule.partnerTier ?? "All tiers"}
                          </td>
                          <td className="py-2 pr-4 text-right font-semibold tabular-nums">
                            {rule.commissionPct}%
                          </td>
                          <td className="py-2">
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                rule.isActive
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
                              )}
                            >
                              {rule.isActive ? "Active" : "Inactive"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ---- Action confirmation panel ---- */}
      {actionState && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border bg-background p-6 shadow-xl">
            <h3 className="mb-1 text-sm font-semibold text-foreground">
              {actionState.action === "mark_paid"
                ? "Mark commission as paid"
                : "Void commission event"}
            </h3>
            <p className="mb-4 text-xs text-muted-foreground">
              {actionState.action === "mark_paid"
                ? "This will mark the commission as paid and decrement the partner's pending balance. This cannot be undone."
                : "This will void the commission and remove it from the partner's pending balance. This cannot be undone."}
            </p>

            <label className="block text-xs font-medium text-foreground mb-1">
              {actionState.action === "mark_paid" ? "Note (optional)" : "Reason (optional)"}
            </label>
            <input
              type="text"
              maxLength={500}
              value={actionState.note}
              onChange={(e) =>
                setActionState((s) => s && { ...s, note: e.target.value })
              }
              placeholder={
                actionState.action === "mark_paid"
                  ? "e.g. Paid via Stripe, PayPal, etc."
                  : "e.g. Self-referral, duplicate, etc."
              }
              className="mb-4 w-full rounded-lg border bg-muted/30 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />

            {actionState.error && (
              <p className="mb-3 text-xs text-destructive">{actionState.error}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                disabled={actionState.saving}
                onClick={handleAction}
                className={cn(
                  "flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors",
                  actionState.action === "mark_paid"
                    ? "bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                    : "bg-zinc-700 hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-600 dark:hover:bg-zinc-500",
                )}
              >
                {actionState.saving ? (
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                ) : actionState.action === "mark_paid" ? (
                  "Confirm — Mark Paid"
                ) : (
                  "Confirm — Void"
                )}
              </button>
              <button
                type="button"
                disabled={actionState.saving}
                onClick={() => setActionState(null)}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
