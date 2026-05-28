"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, ArrowRight, X, PartyPopper } from "lucide-react";
import { useSubAccount } from "@/context/sub-account-context";

interface SetupChecklistProps {
  subAccountId: string;
  contactCount: number;
  dealCount: number;
  formCount: number;
  hasAiAgent: boolean;
  hasSocialConnection: boolean;
  hasAutomation: boolean;
  hasBroadcast: boolean;
  dismissed: boolean;
  onDismiss: () => void;
}

interface ChecklistItem {
  label: string;
  href: string;
  done: boolean;
}

export function SetupChecklist({
  contactCount,
  dealCount,
  formCount,
  hasAiAgent,
  hasSocialConnection,
  hasAutomation,
  hasBroadcast,
  dismissed,
  onDismiss,
}: SetupChecklistProps) {
  const { saPath } = useSubAccount();
  const [autoDismissed, setAutoDismissed] = useState(false);

  const items: ChecklistItem[] = [
    { label: "Add your first contact", href: "/contacts", done: contactCount > 0 },
    { label: "Create a form", href: "/forms", done: formCount > 0 },
    { label: "Open a deal", href: "/pipeline", done: dealCount > 0 },
    { label: "Set up your AI agent", href: "/ai-agents", done: hasAiAgent },
    { label: "Connect a social account", href: "/social", done: hasSocialConnection },
    { label: "Create an automation", href: "/automations", done: hasAutomation },
    { label: "Send a broadcast", href: "/broadcasts", done: hasBroadcast },
  ];

  const completedCount = items.filter((i) => i.done).length;
  const total = items.length;
  const allDone = completedCount === total;

  useEffect(() => {
    if (!allDone) return;
    const timer = setTimeout(() => {
      setAutoDismissed(true);
      onDismiss();
    }, 5000);
    return () => clearTimeout(timer);
  }, [allDone, onDismiss]);

  if (dismissed || autoDismissed) return null;

  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold">Setup Progress</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {completedCount} of {total} complete
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Dismiss setup checklist"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500"
          style={{ width: `${(completedCount / total) * 100}%` }}
        />
      </div>

      {allDone ? (
        <div className="mt-5 flex flex-col items-center gap-2 py-4 text-center">
          <PartyPopper className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-semibold">You are all set!</p>
          <p className="text-xs text-muted-foreground">
            Great job completing your setup. This card will disappear shortly.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-1">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={saPath(item.href)}
                className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/50"
              >
                {item.done ? (
                  <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-emerald-500" />
                ) : (
                  <Circle className="h-4.5 w-4.5 shrink-0 text-muted-foreground/50" />
                )}
                <span
                  className={
                    item.done
                      ? "flex-1 text-muted-foreground line-through"
                      : "flex-1"
                  }
                >
                  {item.label}
                </span>
                {!item.done && (
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
