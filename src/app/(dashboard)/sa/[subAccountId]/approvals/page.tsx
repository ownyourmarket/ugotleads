"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";

type ApprovalStatus = "pending" | "approved" | "rejected";
type FilterTab = "all" | ApprovalStatus;

interface ApprovalDoc {
  id: string;
  type: "social-post" | "ai-reply" | "broadcast" | "enrichment";
  title: string;
  content: string;
  status: ApprovalStatus;
  submittedBy: string;
  metadata?: Record<string, unknown> | null;
  createdAt?: { seconds: number };
  reviewedAt?: { seconds: number } | null;
  reviewedBy?: string | null;
  rejectionNote?: string | null;
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  "social-post": {
    label: "Social Post",
    color:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  },
  "ai-reply": {
    label: "AI Reply",
    color:
      "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  },
  broadcast: {
    label: "Broadcast",
    color:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
  enrichment: {
    label: "Enrichment",
    color:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
};

const STATUS_LABELS: Record<ApprovalStatus, { label: string; color: string }> =
  {
    pending: {
      label: "Pending",
      color:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    },
    approved: {
      label: "Approved",
      color:
        "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    },
    rejected: {
      label: "Rejected",
      color:
        "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    },
  };

export default function ApprovalsPage() {
  const { subAccountId } = useParams<{ subAccountId: string }>();
  const [approvals, setApprovals] = useState<ApprovalDoc[]>([]);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    const db = getFirebaseDb();
    const q = query(
      collection(db, `subAccounts/${subAccountId}/approvals`),
      orderBy("createdAt", "desc"),
    );
    return onSnapshot(q, (snap) => {
      setApprovals(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ApprovalDoc),
      );
    });
  }, [subAccountId]);

  const filtered =
    filter === "all"
      ? approvals
      : approvals.filter((a) => a.status === filter);

  async function handleAction(
    approvalId: string,
    action: "approve" | "reject",
  ) {
    const note =
      action === "reject"
        ? window.prompt("Rejection reason (optional):")
        : undefined;

    setActing(approvalId);
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/approvals`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approvalId,
            action,
            note: note || undefined,
          }),
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.success(
        action === "approve" ? "Item approved." : "Item rejected.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActing(null);
    }
  }

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: `All (${approvals.length})` },
    {
      key: "pending",
      label: `Pending (${approvals.filter((a) => a.status === "pending").length})`,
    },
    {
      key: "approved",
      label: `Approved (${approvals.filter((a) => a.status === "approved").length})`,
    },
    {
      key: "rejected",
      label: `Rejected (${approvals.filter((a) => a.status === "rejected").length})`,
    },
  ];

  return (
    <div className="container max-w-5xl space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-bold">Approval Inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review AI-generated content before it goes live. Approve or reject
          social posts, AI replies, broadcasts, and enrichment suggestions.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg border bg-muted/50 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === tab.key
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {filter === "all"
              ? "No approval items yet. When AI generates content for review, it will appear here."
              : `No ${filter} items.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <ApprovalCard
              key={item.id}
              item={item}
              acting={acting === item.id}
              onAction={handleAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  item,
  acting,
  onAction,
}: {
  item: ApprovalDoc;
  acting: boolean;
  onAction: (id: string, action: "approve" | "reject") => void;
}) {
  const typeMeta = TYPE_LABELS[item.type] ?? {
    label: item.type,
    color: "bg-muted text-muted-foreground",
  };
  const statusMeta = STATUS_LABELS[item.status];

  return (
    <div className="rounded-xl border bg-card p-6 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${typeMeta.color}`}
          >
            {typeMeta.label}
          </span>
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusMeta.color}`}
          >
            {statusMeta.label}
          </span>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {item.createdAt
            ? new Date(item.createdAt.seconds * 1000).toLocaleString()
            : ""}
        </span>
      </div>

      <h3 className="text-sm font-semibold">{item.title}</h3>

      <div className="max-h-40 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
        {item.content}
      </div>

      <div className="text-xs text-muted-foreground">
        Submitted by: {item.submittedBy}
      </div>

      {/* Review info for non-pending items */}
      {item.status !== "pending" && item.reviewedAt && (
        <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
          <div>
            Reviewed by {item.reviewedBy ?? "unknown"} on{" "}
            {new Date(item.reviewedAt.seconds * 1000).toLocaleString()}
          </div>
          {item.rejectionNote && (
            <div>
              <span className="font-medium text-foreground">Note:</span>{" "}
              {item.rejectionNote}
            </div>
          )}
        </div>
      )}

      {/* Action buttons for pending items */}
      {item.status === "pending" && (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={acting}
            onClick={() => onAction(item.id, "approve")}
            className="h-9 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {acting ? "..." : "Approve"}
          </button>
          <button
            type="button"
            disabled={acting}
            onClick={() => onAction(item.id, "reject")}
            className="h-9 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950 disabled:opacity-50"
          >
            {acting ? "..." : "Reject"}
          </button>
        </div>
      )}
    </div>
  );
}
