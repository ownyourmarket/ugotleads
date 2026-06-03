"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Download, Radio, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { subscribeToPartnerNetworkEvents } from "@/lib/firestore/partner-network";
import type {
  PartnerNetworkEvent,
  PartnerNetworkEventStatus,
} from "@/types/partner-network";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const ts = value as { toDate?: () => Date };
  return typeof ts.toDate === "function" ? ts.toDate() : (value as Date);
}

function fmtDateTime(value: unknown): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtIso(value: unknown): string {
  const d = toDate(value);
  return d ? d.toISOString() : "";
}

const STATUS_STYLES: Record<PartnerNetworkEventStatus, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  exported: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  ignored: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

function payloadPreview(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload).filter(([, v]) => v !== null && v !== "");
  if (entries.length === 0) return "—";
  return entries.slice(0, 4).map(([k, v]) => `${k}: ${String(v)}`).join(" · ");
}

// ---------------------------------------------------------------------------
// CSV / JSON export (client-side Blob download — no external call)
// ---------------------------------------------------------------------------

const CSV_COLUMNS = [
  "id",
  "eventType",
  "entityType",
  "entityId",
  "status",
  "source",
  "schemaVersion",
  "occurredAt",
  "createdAt",
  "errorMessage",
  "payload",
] as const;

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function eventsToCsv(events: PartnerNetworkEvent[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = events.map((e) =>
    CSV_COLUMNS.map((col) => {
      switch (col) {
        case "occurredAt": return csvEscape(fmtIso(e.occurredAt));
        case "createdAt": return csvEscape(fmtIso(e.createdAt));
        case "payload": return csvEscape(JSON.stringify(e.payload));
        case "errorMessage": return csvEscape(e.errorMessage ?? "");
        default: return csvEscape(String(e[col] ?? ""));
      }
    }).join(","),
  );
  return [header, ...rows].join("\n");
}

function eventsToJson(events: PartnerNetworkEvent[]): string {
  return JSON.stringify(
    events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      entityType: e.entityType,
      entityId: e.entityId,
      status: e.status,
      source: e.source,
      schemaVersion: e.schemaVersion,
      occurredAt: fmtIso(e.occurredAt),
      createdAt: fmtIso(e.createdAt),
      errorMessage: e.errorMessage,
      payload: e.payload,
    })),
    null,
    2,
  );
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------

function EventDrawer({
  event,
  onClose,
  onStatusChanged,
}: {
  event: PartnerNetworkEvent;
  onClose: () => void;
  onStatusChanged: (msg: string) => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<PartnerNetworkEventStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(status: PartnerNetworkEventStatus) {
    setSaving(status);
    setError(null);
    try {
      const res = await fetch("/api/agency/partner-network-events/status", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id, status, note: note.trim() || null }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) setError(data.error ?? "Update failed.");
      else { onStatusChanged(`Marked ${status}.`); onClose(); }
    } catch {
      setError("Network error.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-hidden border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="min-w-0">
            <code className="font-mono text-sm font-semibold text-foreground">{event.eventType}</code>
            <p className="text-xs text-muted-foreground">{event.entityType}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 text-sm">
          {/* Meta */}
          <dl className="space-y-2">
            {[
              ["Status", event.status],
              ["Entity id", event.entityId],
              ["Idempotency key", event.idempotencyKey],
              ["Source", event.source],
              ["Schema version", String(event.schemaVersion)],
              ["Occurred at", fmtIso(event.occurredAt) || "—"],
              ["Recorded at", fmtIso(event.createdAt) || "—"],
              ["Export attempts", String(event.exportAttempts ?? 0)],
              ["Last export attempt", fmtIso(event.lastExportAttemptAt) || "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="flex-shrink-0 text-xs text-muted-foreground">{k}</dt>
                <dd className="break-all text-right font-mono text-[11px] text-foreground">{v}</dd>
              </div>
            ))}
          </dl>

          {event.errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/20 dark:text-red-300">
              {event.errorMessage}
            </div>
          )}

          {/* Full payload */}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Full payload</p>
            <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-[11px] text-foreground">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </div>

          {/* Status controls */}
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Status controls (metadata only)
            </p>
            <p className="mb-3 text-[11px] text-muted-foreground">
              These update outbox status/export metadata only. They never modify the source purchase,
              entitlement, commission, or any core record.
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Optional note (stored as errorMessage when marking failed)"
              className="mb-3 w-full resize-none rounded-lg border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={saving !== null} onClick={() => setStatus("pending")}
                className="rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-60">
                {saving === "pending" ? "…" : "Mark pending"}
              </button>
              <button type="button" disabled={saving !== null} onClick={() => setStatus("exported")}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
                {saving === "exported" ? "…" : "Mark exported"}
              </button>
              <button type="button" disabled={saving !== null} onClick={() => setStatus("ignored")}
                className="rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-60">
                {saving === "ignored" ? "…" : "Mark ignored"}
              </button>
              <button type="button" disabled={saving !== null} onClick={() => setStatus("failed")}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-60 dark:border-red-800 dark:bg-red-950/20 dark:text-red-300">
                {saving === "failed" ? "…" : "Mark failed"}
              </button>
            </div>
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PartnerNetworkEventsPage() {
  const { agencyId, agencyRole } = useAuth();
  const isOwner = agencyRole === "owner";

  const [events, setEvents] = useState<PartnerNetworkEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState<"all" | PartnerNetworkEventStatus>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDateStr, setToDateStr] = useState("");

  const [selected, setSelected] = useState<PartnerNetworkEvent | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!agencyId || !isOwner) { setLoading(false); return; }
    const unsub = subscribeToPartnerNetworkEvents(
      agencyId,
      (data) => { setEvents(data); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, [agencyId, isOwner]);

  // Keep the selected event in sync with live data
  useEffect(() => {
    if (!selected) return;
    const updated = events.find((e) => e.id === selected.id);
    if (updated) setSelected(updated);
  }, [events]); // eslint-disable-line react-hooks/exhaustive-deps

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  }

  const eventTypes = useMemo(() => Array.from(new Set(events.map((e) => e.eventType))).sort(), [events]);
  const entityTypes = useMemo(() => Array.from(new Set(events.map((e) => e.entityType))).sort(), [events]);

  const filtered = useMemo(() => {
    let list = events;
    if (statusFilter !== "all") list = list.filter((e) => e.status === statusFilter);
    if (typeFilter !== "all") list = list.filter((e) => e.eventType === typeFilter);
    if (entityFilter !== "all") list = list.filter((e) => e.entityType === entityFilter);
    if (fromDate) {
      const from = new Date(fromDate).getTime();
      list = list.filter((e) => (toDate(e.createdAt)?.getTime() ?? 0) >= from);
    }
    if (toDateStr) {
      const to = new Date(toDateStr).getTime() + 24 * 60 * 60 * 1000; // inclusive end-of-day
      list = list.filter((e) => (toDate(e.createdAt)?.getTime() ?? 0) <= to);
    }
    return [...list].sort((a, b) => {
      const ad = (a.createdAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
      const bd = (b.createdAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
      return bd - ad;
    });
  }, [events, statusFilter, typeFilter, entityFilter, fromDate, toDateStr]);

  function exportCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(eventsToCsv(filtered), `partner-network-events-${stamp}.csv`, "text/csv");
  }
  function exportJson() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(eventsToJson(filtered), `partner-network-events-${stamp}.json`, "application/json");
  }

  if (!isOwner) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <Radio className="h-10 w-10 text-muted-foreground/40" />
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
            <Radio className="h-4 w-4" />
            <span className="text-sm font-medium uppercase tracking-wider">Revenue OS — Agency</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Partner Events</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Append-only outbox report for the future MyUSA Partner Network.
          </p>
        </div>
        {!loading && events.length > 0 && (
          <div className="flex gap-2">
            <button type="button" onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button type="button" onClick={exportJson}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              <Download className="h-3.5 w-3.5" /> JSON
            </button>
          </div>
        )}
      </div>

      {/* Safety copy */}
      <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 dark:border-sky-800 dark:bg-sky-950/20">
        <Activity className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-600 dark:text-sky-400" />
        <p className="text-xs text-sky-700 dark:text-sky-300">
          This is an outbox report only. It does not calculate MLM compensation, rank, genealogy,
          team volume, or payouts. Emission is gated by{" "}
          <code className="rounded bg-sky-100 px-1 font-mono dark:bg-sky-900/30">PARTNER_NETWORK_EVENTS_ENABLED</code>;
          no exporter, adapter, or external system is connected.
        </p>
      </div>

      {/* Filters */}
      {!loading && events.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
          <FilterSelect label="Status" value={statusFilter} onChange={(v) => setStatusFilter(v as typeof statusFilter)}
            options={[["all", "All"], ["pending", "Pending"], ["exported", "Exported"], ["ignored", "Ignored"], ["failed", "Failed"]]} />
          <FilterSelect label="Event type" value={typeFilter} onChange={setTypeFilter}
            options={[["all", "All"], ...eventTypes.map((t) => [t, t] as [string, string])]} />
          <FilterSelect label="Entity type" value={entityFilter} onChange={setEntityFilter}
            options={[["all", "All"], ...entityTypes.map((t) => [t, t] as [string, string])]} />
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="rounded-lg border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">To</label>
            <input type="date" value={toDateStr} onChange={(e) => setToDateStr(e.target.value)}
              className="rounded-lg border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          {(statusFilter !== "all" || typeFilter !== "all" || entityFilter !== "all" || fromDate || toDateStr) && (
            <button type="button"
              onClick={() => { setStatusFilter("all"); setTypeFilter("all"); setEntityFilter("all"); setFromDate(""); setToDateStr(""); }}
              className="text-xs text-primary underline underline-offset-2">
              Clear
            </button>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {filtered.length} of {events.length} events
          </span>
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

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <Radio className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {events.length === 0 ? "No events recorded yet." : "No events match these filters."}
            </p>
            {events.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Events appear once PARTNER_NETWORK_EVENTS_ENABLED=true and a core event fires.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      {!loading && filtered.length > 0 && (
        <div className="rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Event type</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Payload preview</th>
                  <th className="px-4 py-3 font-medium">Recorded</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((e) => (
                  <tr key={e.id} className="cursor-pointer hover:bg-muted/20" onClick={() => setSelected(e)}>
                    <td className="px-4 py-3">
                      <code className="font-mono text-[11px] font-medium text-foreground">{e.eventType}</code>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[11px] text-muted-foreground">{e.entityType}</p>
                      <code className="font-mono text-[11px] text-muted-foreground">
                        {e.entityId.slice(0, 18)}{e.entityId.length > 18 ? "…" : ""}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        STATUS_STYLES[e.status] ?? "bg-muted text-muted-foreground",
                      )}>
                        {e.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] text-muted-foreground">{payloadPreview(e.payload)}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDateTime(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <EventDrawer event={selected} onClose={() => setSelected(null)} onStatusChanged={showToast} />
      )}

      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border bg-card px-4 py-3 shadow-lg">
          <p className="text-sm font-medium text-foreground">{toastMsg}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small filter select
// ---------------------------------------------------------------------------

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[180px] rounded-lg border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        {options.map(([val, lbl]) => (
          <option key={val} value={val}>{lbl}</option>
        ))}
      </select>
    </div>
  );
}
