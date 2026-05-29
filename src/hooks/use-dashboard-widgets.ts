"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Dashboard widget IDs. Order here is the default display order.
 */
export const DASHBOARD_WIDGETS = [
  { id: "stats", label: "KPI cards" },
  { id: "map", label: "Leads map" },
  { id: "agenda", label: "Today's agenda" },
  { id: "pipeline", label: "Pipeline snapshot" },
  { id: "contacts", label: "Recent contacts" },
  { id: "automations", label: "Automation activity" },
  { id: "quickActions", label: "Quick actions" },
] as const;

export type WidgetId = (typeof DASHBOARD_WIDGETS)[number]["id"];

const ALL_IDS = DASHBOARD_WIDGETS.map((w) => w.id);

function storageKey(subAccountId: string) {
  return `ugotleads:dash-widgets:${subAccountId}`;
}

function readHidden(subAccountId: string): Set<WidgetId> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(storageKey(subAccountId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed.filter((id) => ALL_IDS.includes(id as WidgetId)) as WidgetId[]);
  } catch {
    return new Set();
  }
}

function writeHidden(subAccountId: string, hidden: Set<WidgetId>) {
  try {
    localStorage.setItem(storageKey(subAccountId), JSON.stringify([...hidden]));
  } catch {
    // localStorage full or unavailable — fail silently
  }
}

export function useDashboardWidgets(subAccountId: string) {
  const [hidden, setHidden] = useState<Set<WidgetId>>(() =>
    readHidden(subAccountId),
  );

  const isVisible = useCallback(
    (id: WidgetId) => !hidden.has(id),
    [hidden],
  );

  const toggle = useCallback(
    (id: WidgetId) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        writeHidden(subAccountId, next);
        return next;
      });
    },
    [subAccountId],
  );

  const resetAll = useCallback(() => {
    const empty = new Set<WidgetId>();
    writeHidden(subAccountId, empty);
    setHidden(empty);
  }, [subAccountId]);

  const hiddenCount = hidden.size;

  return useMemo(
    () => ({ isVisible, toggle, resetAll, hiddenCount }),
    [isVisible, toggle, resetAll, hiddenCount],
  );
}
