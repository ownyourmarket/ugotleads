"use client";

import { Settings2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DASHBOARD_WIDGETS,
  type WidgetId,
} from "@/hooks/use-dashboard-widgets";

interface WidgetSettingsProps {
  isVisible: (id: WidgetId) => boolean;
  toggle: (id: WidgetId) => void;
  resetAll: () => void;
  hiddenCount: number;
}

export function WidgetSettings({
  isVisible,
  toggle,
  resetAll,
  hiddenCount,
}: WidgetSettingsProps) {
  return (
    <div className="group relative">
      <Button variant="ghost" size="icon" className="relative h-8 w-8" title="Customize dashboard">
        <Settings2 className="h-4 w-4" />
        {hiddenCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
            {hiddenCount}
          </span>
        )}
      </Button>

      {/* Hover/focus dropdown */}
      <div className="invisible absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border bg-card p-2 shadow-lg opacity-0 transition-all group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Show / hide widgets
        </p>
        {DASHBOARD_WIDGETS.map((w) => {
          const checked = isVisible(w.id);
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => toggle(w.id)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted/60"
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  checked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/30 bg-background"
                }`}
              >
                {checked && (
                  <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                )}
              </span>
              <span className={checked ? "" : "text-muted-foreground"}>
                {w.label}
              </span>
            </button>
          );
        })}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={resetAll}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to defaults
          </button>
        )}
      </div>
    </div>
  );
}
