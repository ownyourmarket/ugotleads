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

interface SocialPostDoc {
  zernioPostId: string;
  content: string;
  platforms: string[];
  scheduledFor: string | null;
  status: string;
  lastEvent: string;
  perAccount: Array<{
    platform: string;
    status: string;
    platformPostId?: string;
    error?: string;
  }>;
  createdAt: { seconds: number; nanoseconds: number };
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

  // Compose form state
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeText, setComposeText] = useState("");
  const [composePlatforms, setComposePlatforms] = useState<Set<string>>(new Set());
  const [composeScheduleFor, setComposeScheduleFor] = useState("");
  const [publishing, setPublishing] = useState(false);

  // Recent posts
  const [recentPosts, setRecentPosts] = useState<SocialPostDoc[]>([]);

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

  useEffect(() => {
    const db = getFirebaseDb();
    const q = query(
      collection(db, `subAccounts/${subAccountId}/socialPosts`),
      orderBy("createdAt", "desc"),
    );
    return onSnapshot(q, (snap) => {
      setRecentPosts(snap.docs.map((d) => d.data() as SocialPostDoc).slice(0, 20));
    });
  }, [subAccountId]);

  async function publishPost() {
    const text = composeText.trim();
    if (!text) {
      toast.error("Write something first.");
      return;
    }
    if (composePlatforms.size === 0) {
      toast.error("Pick at least one platform.");
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/zernio/post`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: text,
            platforms: Array.from(composePlatforms),
            scheduledFor: composeScheduleFor || undefined,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        missing?: string[];
        postId?: string;
        status?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      toast.success(
        composeScheduleFor
          ? `Scheduled for ${new Date(composeScheduleFor).toLocaleString()}`
          : "Publishing… check the Recent posts list for delivery status.",
      );
      setComposeText("");
      setComposePlatforms(new Set());
      setComposeScheduleFor("");
      setComposeOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

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

      {/* Compose */}
      <div className="rounded-xl border bg-card p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Compose</h2>
          {!composeOpen ? (
            <button
              type="button"
              onClick={() => setComposeOpen(true)}
              disabled={connections.filter((c) => c.status === "active").length === 0}
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              New post
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setComposeOpen(false);
                setComposeText("");
                setComposePlatforms(new Set());
                setComposeScheduleFor("");
              }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </div>
        {!composeOpen ? (
          <p className="text-sm text-muted-foreground">
            {connections.filter((c) => c.status === "active").length === 0
              ? "Connect a social account below first."
              : "Draft a post and publish it to one or more of your connected platforms."}
          </p>
        ) : (
          <div className="space-y-3">
            <textarea
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              placeholder="What do you want to post? Keep it native to each platform — Bluesky cuts at 300, X at 280."
              rows={5}
              className="w-full rounded-md border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              maxLength={8000}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{composeText.length} / 8,000 chars</span>
              <span>
                {composeText.length > 280 && composePlatforms.has("twitter")
                  ? "⚠ Over X's 280 limit"
                  : ""}
                {composeText.length > 300 && composePlatforms.has("bluesky")
                  ? "  ⚠ Over Bluesky's 300 limit"
                  : ""}
              </span>
            </div>
            <div>
              <div className="text-sm font-medium mb-2">Publish to</div>
              <div className="flex flex-wrap gap-2">
                {connections
                  .filter((c) => c.status === "active")
                  .map((c) => {
                    const isSelected = composePlatforms.has(c.platform);
                    const meta = PLATFORMS.find((p) => p.id === c.platform);
                    return (
                      <button
                        key={c.accountId}
                        type="button"
                        onClick={() => {
                          const next = new Set(composePlatforms);
                          isSelected ? next.delete(c.platform) : next.add(c.platform);
                          setComposePlatforms(next);
                        }}
                        className={`px-3 py-1.5 rounded-full text-sm border transition flex items-center gap-2 ${
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border hover:border-foreground/40"
                        }`}
                      >
                        <span aria-hidden>{meta?.emoji ?? "🔗"}</span>
                        <span>
                          {meta?.label ?? c.platform} ·{" "}
                          <span className="opacity-70">
                            {c.displayName || c.username}
                          </span>
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium" htmlFor="schedule-for">
                  Schedule (optional)
                </label>
                <input
                  id="schedule-for"
                  type="datetime-local"
                  value={composeScheduleFor}
                  onChange={(e) => setComposeScheduleFor(e.target.value)}
                  className="mt-1 w-full h-10 px-3 rounded-md border bg-background text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Leave empty to publish immediately.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={publishPost}
              disabled={publishing || !composeText.trim() || composePlatforms.size === 0}
              className="h-10 px-5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {publishing
                ? "Publishing…"
                : composeScheduleFor
                  ? "Schedule"
                  : `Publish to ${composePlatforms.size || 0}`}
            </button>
          </div>
        )}
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

      {/* Recent posts */}
      {recentPosts.length > 0 && (
        <div className="rounded-xl border bg-card p-6 space-y-3">
          <h2 className="text-lg font-semibold">Recent posts</h2>
          <div className="space-y-3">
            {recentPosts.map((p) => (
              <PostRow key={p.zernioPostId} post={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PostRow({ post }: { post: SocialPostDoc }) {
  const statusColor =
    post.status === "published"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
      : post.status === "failed"
        ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
        : post.status === "scheduled"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
          : post.status === "partial"
            ? "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300"
            : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
  const when = post.createdAt
    ? new Date(post.createdAt.seconds * 1000).toLocaleString()
    : "";
  return (
    <div className="rounded-md border p-3 text-sm space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor}`}>
            {post.status}
          </span>
          {post.platforms?.map((p) => (
            <span
              key={p}
              className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
            >
              {p}
            </span>
          ))}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{when}</span>
      </div>
      <div className="whitespace-pre-wrap line-clamp-3">{post.content}</div>
      {post.scheduledFor && post.status === "scheduled" && (
        <div className="text-xs text-amber-700 dark:text-amber-400">
          Scheduled for {new Date(post.scheduledFor).toLocaleString()}
        </div>
      )}
      {post.perAccount?.some((a) => a.error) && (
        <div className="text-xs text-red-600 dark:text-red-400">
          {post.perAccount
            .filter((a) => a.error)
            .map((a) => `${a.platform}: ${a.error}`)
            .join("  ·  ")}
        </div>
      )}
    </div>
  );
}
