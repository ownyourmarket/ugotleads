"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  FileText,
  Trophy,
  XCircle,
  ClipboardCheck,
  AlertTriangle,
  UserCheck,
  Send,
} from "lucide-react";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  where,
  type Timestamp,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  linkTo: string | null;
  read: boolean;
  createdAt: Timestamp;
}

const TYPE_ICONS: Record<string, typeof Bell> = {
  form_submission: FileText,
  deal_won: Trophy,
  deal_lost: XCircle,
  approval_pending: ClipboardCheck,
  escalation: AlertTriangle,
  contact_enriched: UserCheck,
  broadcast_complete: Send,
  system: Bell,
};

function relativeTime(ts: Timestamp): string {
  const now = Date.now();
  const then = ts.toMillis();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

interface NotificationBellProps {
  subAccountId: string;
}

export function NotificationBell({ subAccountId }: NotificationBellProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const db = getFirebaseDb();
    const colRef = collection(
      db,
      "subAccounts",
      subAccountId,
      "notifications",
    );
    const q = query(colRef, orderBy("createdAt", "desc"), limit(20));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: Notification[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Notification, "id">),
        }));
        setNotifications(items);
        setUnreadCount(items.filter((n) => !n.read).length);
      },
      (err) => {
        console.error("[notification-bell] onSnapshot error:", err);
      },
    );

    return unsub;
  }, [subAccountId]);

  const markAllRead = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/notifications`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markAllRead: true }),
        },
      );
      if (!res.ok) throw new Error("Failed to mark all read");
    } catch {
      toast.error("Could not mark notifications as read");
    }
  }, [subAccountId]);

  const handleClick = useCallback(
    async (notif: Notification) => {
      if (!notif.read) {
        try {
          await fetch(
            `/api/sub-accounts/${subAccountId}/notifications`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ notificationIds: [notif.id] }),
            },
          );
        } catch {
          // best-effort
        }
      }
      if (notif.linkTo) {
        router.push(`/sa/${subAccountId}${notif.linkTo}`);
      }
    },
    [subAccountId, router],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={
              unreadCount > 0
                ? `${unreadCount} unread notifications`
                : "Notifications"
            }
          />
        }
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-xs font-medium text-primary hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            notifications.map((notif) => {
              const Icon = TYPE_ICONS[notif.type] ?? Bell;
              return (
                <button
                  key={notif.id}
                  type="button"
                  onClick={() => handleClick(notif)}
                  className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted ${
                    !notif.read ? "bg-primary/5" : ""
                  }`}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {notif.title}
                    </p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {notif.message}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {notif.createdAt && relativeTime(notif.createdAt)}
                  </span>
                  {!notif.read && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
