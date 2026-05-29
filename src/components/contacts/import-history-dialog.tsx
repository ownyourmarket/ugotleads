"use client";

import { useEffect, useState } from "react";
import {
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  History,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useSubAccount } from "@/context/sub-account-context";
import { subscribeToImportLogs } from "@/lib/firestore/contacts";
import { formatRelativeTime } from "@/lib/format";
import type { ImportLog } from "@/types/contacts";

interface ImportHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportHistoryDialog({
  open,
  onOpenChange,
}: ImportHistoryDialogProps) {
  const { subAccountId, agencyId } = useSubAccount();
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !agencyId) return;
    setLoading(true);
    const unsub = subscribeToImportLogs(
      { agencyId, subAccountId },
      (list) => {
        setLogs(list);
        setLoading(false);
      },
    );
    return unsub;
  }, [open, agencyId, subAccountId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Import history</SheetTitle>
          <SheetDescription>
            Audit log of every CSV import into this sub-account.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 p-4 pt-0">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border bg-card p-4"
                >
                  <div className="mb-2 h-3 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-full animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card/50 p-8 text-center">
              <History className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No imports yet</p>
              <p className="text-xs text-muted-foreground">
                CSV imports will be logged here automatically.
              </p>
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="rounded-xl border bg-card p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate text-sm font-medium">
                      {log.fileName}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(log.createdAt)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" />
                    {log.created} created
                  </span>
                  {log.skipped > 0 && (
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" />
                      {log.skipped} skipped
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {log.totalRows} total rows
                  </span>
                </div>

                <p className="text-xs text-muted-foreground">
                  by {log.importedByName}
                </p>

                {log.errors.length > 0 && (
                  <ul className="ml-5 list-disc space-y-0.5 text-xs text-muted-foreground">
                    {log.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
