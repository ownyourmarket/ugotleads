"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";

const PLATFORMS: { id: string; label: string; emoji: string }[] = [
  { id: "facebook", label: "Facebook", emoji: "📘" },
  { id: "instagram", label: "Instagram", emoji: "📷" },
  { id: "linkedin", label: "LinkedIn", emoji: "💼" },
  { id: "twitter", label: "X (Twitter)", emoji: "𝕏" },
  { id: "tiktok", label: "TikTok", emoji: "🎵" },
  { id: "youtube", label: "YouTube", emoji: "▶️" },
  { id: "pinterest", label: "Pinterest", emoji: "📌" },
  { id: "threads", label: "Threads", emoji: "🧵" },
  { id: "gmb", label: "Google Business", emoji: "🏢" },
  { id: "reddit", label: "Reddit", emoji: "👽" },
  { id: "bluesky", label: "Bluesky", emoji: "🦋" },
];

interface ConnectionDoc {
  accountId: string;
  platform: string;
  username: string | null;
  displayName: string | null;
  status: "active" | "disconnected";
}

export default function SocialPage() {
  const { subAccountId } = useParams<{ subAccountId: string }>();
  const params = useSearchParams();
  const justConnected = params.get("connected");

  const [connections, setConnections] = useState<ConnectionDoc[]>([]);
  const [provisioning, setProvisioning] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (justConnected) {
      toast.success(`Connected ${justConnected}. Refreshing connections…`);
    }
  }, [justConnected]);

  // Background sync from Zernio on page load (and whenever we just came back
  // from a connect flow). Keeps the UI honest even if a webhook is delayed
  // or the sub-account doc never had zernioProfileId persisted.
  async function syncFromZernio(opts: { silent?: boolean } = {}) {
    setSyncing(true);
    try {
      // First make sure the sub-account is paired with a Zernio Profile.
      await fetch(`/api/sub-accounts/${subAccountId}/zernio/provision`, {
        method: "POST",
      });
      const res = await fetch(`/api/sub-accounts/${subAccountId}/zernio/sync`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json()) as { message?: string; error?: string };
        throw new Error(data.message ?? data.error ?? "Sync failed");
      }
      if (!opts.silent) {
        const data = (await res.json()) as { accountsSynced?: number };
        toast.success(
          `Synced ${data.accountsSynced ?? 0} connection${
            data.accountsSynced === 1 ? "" : "s"
          } from Zernio.`,
        );
      }
    } catch (err) {
      if (!opts.silent) {
        toast.error(err instanceof Error ? err.message : "Sync failed");
      } else {
        console.warn("[social] silent sync failed:", err);
      }
    } finally {
      setSyncing(false);
    }
  }

  // Auto-sync on first load + whenever ?connected=X just landed.
  useEffect(() => {
    void syncFromZernio({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subAccountId, justConnected]);

  useEffect(() => {
    const db = getFirebaseDb();
    const q = query(
      collection(db, `subAccounts/${subAccountId}/socialConnections`),
      orderBy("connectedAt", "desc"),
    );
    return onSnapshot(q, (snap) => {
      setConnections(snap.docs.map((d) => d.data() as ConnectionDoc));
    });
  }, [subAccountId]);

  async function ensureProvisioned(): Promise<string | null> {
    if (profileId) return profileId;
    setProvisioning(true);
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/zernio/provision`,
        { method: "POST" },
      );
      const data = (await res.json()) as { profileId?: string; message?: string; error?: string };
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setProfileId(data.profileId ?? null);
      return data.profileId ?? null;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't provision Zernio");
      return null;
    } finally {
      setProvisioning(false);
    }
  }

  async function connect(platform: string) {
    setConnectingPlatform(platform);
    try {
      const pid = await ensureProvisioned();
      if (!pid) return;
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/zernio/connect?platform=${platform}`,
      );
      const data = (await res.json()) as { url?: string; message?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.message ?? data.error ?? "Couldn't get connect URL");
      }
      // Redirect operator to Zernio's hosted OAuth Connect flow.
      window.location.href = data.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connect failed");
      setConnectingPlatform(null);
    }
  }

  const connectedByPlatform = new Map<string, ConnectionDoc[]>();
  for (const c of connections) {
    if (c.status !== "active") continue;
    const list = connectedByPlatform.get(c.platform) ?? [];
    list.push(c);
    connectedByPlatform.set(c.platform, list);
  }

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Social</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect your social accounts. UGotLeads publishes through
            authorized integrations — every post is logged, every action is
            auditable, and you can revoke access from each platform at any time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void syncFromZernio({ silent: false })}
          disabled={syncing}
          className="shrink-0 h-9 px-3 rounded-md border text-sm font-medium hover:bg-muted/50 disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "Sync"}
        </button>
      </div>

      <div className="rounded-xl border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Available platforms</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PLATFORMS.map((p) => {
            const connected = connectedByPlatform.get(p.id) ?? [];
            const isConnecting = connectingPlatform === p.id || provisioning;
            return (
              <div
                key={p.id}
                className="rounded-lg border p-4 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl" aria-hidden>{p.emoji}</span>
                    <span className="font-medium">{p.label}</span>
                  </div>
                  {connected.length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                      {connected.length} connected
                    </span>
                  )}
                </div>
                {connected.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {connected.map((c) => c.displayName || c.username).join(", ")}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => connect(p.id)}
                  disabled={isConnecting}
                  className="mt-1 h-9 px-3 rounded-md border text-sm font-medium hover:bg-muted/50 disabled:opacity-50"
                >
                  {isConnecting
                    ? "Opening…"
                    : connected.length > 0
                      ? "Connect another account"
                      : "Connect"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {connections.length === 0 && (
        <div className="rounded-xl border border-dashed bg-card/50 p-8 text-center text-sm text-muted-foreground">
          No social accounts connected yet. Pick a platform above to get started.
        </div>
      )}
    </div>
  );
}
