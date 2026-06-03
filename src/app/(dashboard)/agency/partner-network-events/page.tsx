"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Radio } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { subscribeToPartnerNetworkEvents } from "@/lib/firestore/partner-network";
import type { PartnerNetworkEvent, PartnerNetworkEventStatus } from "@/types/partner-network";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDateTime(value: unknown): string {
  if (!value) return "—";
  const ts = value as { toDate?: () => Date };
  const d = typeof ts.toDate === "function" ? ts.toDate() : (value as Date);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  return entries
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

type FilterKey = "all" | PartnerNetworkEventStatus | string; // or eventType

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PartnerNetworkEventsPage() {
  const { agencyId, agencyRole } = useAuth();
  const isOwner = agencyRole === "owner";

  const [events, setEvents] = useState<PartnerNetworkEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    if (!agencyId || !isOwner) {
      setLoading(false);
      return;
    }
    const unsub = subscribeToPartnerNetworkEvents(
      agencyId,
      (data) => {
        setEvents(data);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [agencyId, isOwner]);

  const eventTypes = useMemo(
    () => Array.from(new Set(events.map((e) => e.eventType))).sort(),
    [events],
  );

  const filtered = useMemo(() => {
    let list = events;
    if (filter !== "all") {
      if (["pending", "exported", "ignored", "failed"].includes(filter)) {
        list = list.filter((e) => e.status === filter);
      } else {
        list = list.filter((e) => e.eventType === filter);
      }
    }
    return [...list].sort((a, b) => {
      const ad = (a.createdAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
      const bd = (b.createdAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
      return bd - ad;
    });
  }, [events, filter]);

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
      <div>
        <div className="mb-1 flex items-center gap-2 text-muted-foreground">
          <Radio className="h-4 w-4" />
          <span className="text-sm font-medium uppercase tracking-wider">Revenue OS — Agency</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Partner Events</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Append-only outbox of factual events for the future MyUSA Partner Network.
          Read-only — no consumer or exporter is connected yet.
        </p>
      </div>

      {/* Dormant notice */}
      <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 dark:border-sky-800 dark:bg-sky-950/20">
        <Activity className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-600 dark:text-sky-400" />
        <p className="text-xs text-sky-700 dark:text-sky-300">
          Event emission is gated by <code className="rounded bg-sky-100 px-1 font-mono dark:bg-sky-900/30">PARTNER_NETWORK_EVENTS_ENABLED</code>.
          When off (default), no events are recorded. No MLM engine, exporter, or adapter is connected — this is a recording surface only.
        </p>
      </div>

      {/* Filters */}
      {!loading && events.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "pending", "exported", "ignored", "failed"] as FilterKey[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors",
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
          {eventTypes.length > 0 && <span className="mx-1 text-muted-foreground/30">|</span>}
          {eventTypes.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilter(filter === t ? "all" : t)}
              className={cn(
                "rounded-full px-3 py-1 font-mono text-[11px] font-medium transition-colors",
                filter === t
                  ? "bg-primary text-primary-foreground"
                  : "border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
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
              {events.length === 0 ? "No events recorded yet." : "No events match this filter."}
            </p>
            {events.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Events appear here once PARTNER_NETWORK_EVENTS_ENABLED=true and a core event fires.
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
                  <th className="px-4 py-3 font-medium">Occurred</th>
                  <th className="px-4 py-3 font-medium">Recorded</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <code className="font-mono text-[11px] font-medium text-foreground">{e.eventType}</code>
                      {e.errorMessage && (
                        <p className="mt-0.5 text-[10px] text-red-600 dark:text-red-400">{e.errorMessage}</p>
                      )}
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
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDateTime(e.occurredAt)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDateTime(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
