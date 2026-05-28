"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  limit,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type {
  ContentCadence,
  GeneratedPost,
  SocialContentBatch,
  SocialPlatform,
  SocialVoice,
} from "@/types/social-content";

const PLATFORMS: { id: SocialPlatform; label: string }[] = [
  { id: "facebook", label: "Facebook" },
  { id: "instagram", label: "Instagram" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "x", label: "X (Twitter)" },
];

// Social Content Generator uses "x" as the platform slug; Zernio uses
// "twitter". Every other platform slug matches. This map normalizes the
// publish call so operators never see the discrepancy.
const SOCIAL_TO_ZERNIO_PLATFORM: Record<SocialPlatform, string> = {
  facebook: "facebook",
  instagram: "instagram",
  linkedin: "linkedin",
  x: "twitter",
};

const VOICES: { id: SocialVoice; label: string }[] = [
  { id: "professional", label: "Professional" },
  { id: "casual", label: "Casual" },
  { id: "bold", label: "Bold" },
  { id: "warm", label: "Warm" },
  { id: "expert", label: "Expert" },
];

type BatchSummary = SocialContentBatch;

export default function SocialContentPage() {
  const { subAccountId } = useParams<{ subAccountId: string }>();
  const [recentBatches, setRecentBatches] = useState<BatchSummary[]>([]);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [activeBatch, setActiveBatch] = useState<BatchSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Set of platform slugs that have an active social connection on this
  // sub-account. Drives which posts can be Published with one click vs.
  // need the operator to connect the platform first.
  const [connectedPlatforms, setConnectedPlatforms] = useState<Set<string>>(
    new Set(),
  );

  // Form state
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [voice, setVoice] = useState<SocialVoice>("professional");
  const [products, setProducts] = useState("");
  const [audience, setAudience] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [enabledPlatforms, setEnabledPlatforms] = useState<Set<SocialPlatform>>(
    new Set(["facebook", "instagram", "linkedin", "x"]),
  );
  const [postsPerWeek, setPostsPerWeek] = useState<3 | 5 | 7>(5);
  const [weeks, setWeeks] = useState(4);

  // List subscription
  useEffect(() => {
    const db = getFirebaseDb();
    const q = query(
      collection(db, `subAccounts/${subAccountId}/socialContent`),
      orderBy("createdAt", "desc"),
      limit(10),
    );
    return onSnapshot(q, (snap) => {
      setRecentBatches(snap.docs.map((d) => d.data() as BatchSummary));
    });
  }, [subAccountId]);

  // Active batch subscription
  useEffect(() => {
    if (!activeBatchId) {
      setActiveBatch(null);
      return;
    }
    const db = getFirebaseDb();
    const ref = doc(db, `subAccounts/${subAccountId}/socialContent/${activeBatchId}`);
    return onSnapshot(ref, (snap) => {
      if (snap.exists()) setActiveBatch(snap.data() as BatchSummary);
    });
  }, [subAccountId, activeBatchId]);

  // Which platforms is this sub-account connected to via Zernio? Drives
  // the per-post Publish button — generated posts for unconnected
  // platforms surface a "Connect to publish" link instead of Publish.
  useEffect(() => {
    const db = getFirebaseDb();
    const q = query(
      collection(db, `subAccounts/${subAccountId}/socialConnections`),
    );
    return onSnapshot(q, (snap) => {
      const next = new Set<string>();
      for (const d of snap.docs) {
        const data = d.data() as { platform?: string; status?: string };
        if (data.status === "active" && data.platform) next.add(data.platform);
      }
      setConnectedPlatforms(next);
    });
  }, [subAccountId]);

  async function generate() {
    if (!industry || !location || !products || !audience) {
      toast.error("Fill in industry, location, products, and audience.");
      return;
    }
    if (enabledPlatforms.size === 0) {
      toast.error("Pick at least one platform.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/social-content/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessProfile: {
              industry,
              location,
              voice,
              products,
              audience,
              websiteUrl: websiteUrl.trim() || undefined,
            },
            cadence: {
              platforms: Array.from(enabledPlatforms),
              postsPerWeek,
              weeks,
            } satisfies ContentCadence,
          }),
        },
      );
      const data = (await res.json()) as { batchId?: string; message?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      toast.success("Generation started. Posts will stream in as each week completes.");
      setActiveBatchId(data.batchId ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AI Social Content</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate 30 days of platform-aware social posts. Output streams in
          weekly batches as the AI completes each week.
        </p>
      </div>

      {/* Wizard form */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">New content plan</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Industry" required>
            <input
              type="text"
              placeholder="e.g. HVAC, real estate, dental practice"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Location" required>
            <input
              type="text"
              placeholder="e.g. Atlanta, GA"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Voice" required>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value as SocialVoice)}
              className="input"
            >
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Website (optional)">
            <input
              type="url"
              placeholder="https://yourbusiness.com"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Products / services" required full>
            <textarea
              placeholder="e.g. 24/7 emergency HVAC repair, annual maintenance plans, mini-split installs"
              value={products}
              onChange={(e) => setProducts(e.target.value)}
              rows={2}
              className="input"
            />
          </Field>
          <Field label="Target audience" required full>
            <textarea
              placeholder="e.g. Homeowners 35-65 in metro Atlanta, value reliability over price"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              rows={2}
              className="input"
            />
          </Field>
        </div>

        <div>
          <div className="text-sm font-medium mb-2">Platforms</div>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  const next = new Set(enabledPlatforms);
                  next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                  setEnabledPlatforms(next);
                }}
                className={`px-3 py-1.5 rounded-full text-sm border transition ${
                  enabledPlatforms.has(p.id)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:border-foreground/40"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Posts per week">
            <select
              value={postsPerWeek}
              onChange={(e) => setPostsPerWeek(Number(e.target.value) as 3 | 5 | 7)}
              className="input"
            >
              <option value={3}>3</option>
              <option value={5}>5 (recommended)</option>
              <option value={7}>7 (daily)</option>
            </select>
          </Field>
          <Field label="Weeks">
            <select
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              className="input"
            >
              <option value={1}>1 week (~7 posts)</option>
              <option value={2}>2 weeks</option>
              <option value={4}>4 weeks (~30 days)</option>
              <option value={8}>8 weeks (~60 days)</option>
            </select>
          </Field>
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={submitting}
          className="h-10 px-5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Starting…" : `Generate ${enabledPlatforms.size * postsPerWeek * weeks} posts`}
        </button>
      </div>

      {/* Active batch progress */}
      {activeBatch && (
        <BatchResult
          batch={activeBatch}
          connectedPlatforms={connectedPlatforms}
          subAccountId={subAccountId}
        />
      )}

      {/* Recent batches */}
      <div className="rounded-xl border bg-card p-6 space-y-3">
        <h2 className="text-lg font-semibold">Recent batches</h2>
        {recentBatches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No content batches yet.</p>
        ) : (
          <div className="space-y-2">
            {recentBatches.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setActiveBatchId(b.id)}
                className="w-full text-left p-3 rounded-md border hover:bg-muted/50 transition"
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium">
                    {b.businessProfile?.industry || "Untitled"} ·{" "}
                    {b.businessProfile?.location}
                  </div>
                  <StatusBadge status={b.status} />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {b.progress?.completed ?? 0} / {b.progress?.total ?? 0} posts ·{" "}
                  {b.cadence?.platforms?.join(", ")}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          height: 2.5rem;
          padding: 0.5rem 0.75rem;
          border-radius: 0.375rem;
          border: 1px solid hsl(var(--border));
          background: hsl(var(--background));
          font-size: 0.875rem;
        }
        :global(textarea.input) {
          height: auto;
          min-height: 4rem;
          padding-top: 0.5rem;
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
  required,
  full,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="block text-sm font-medium mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: SocialContentBatch["status"] }) {
  const styles = {
    queued: "bg-muted text-muted-foreground",
    generating: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 animate-pulse",
    ready: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  }[status];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles}`}>
      {status}
    </span>
  );
}

function BatchResult({
  batch,
  connectedPlatforms,
  subAccountId,
}: {
  batch: BatchSummary;
  connectedPlatforms: Set<string>;
  subAccountId: string;
}) {
  const pct = batch.progress?.total
    ? (batch.progress.completed / batch.progress.total) * 100
    : 0;

  const [scheduling, setScheduling] = useState(false);
  const [scheduledCount, setScheduledCount] = useState<number | null>(null);

  // "Schedule all" — publishes every post to connected platforms with
  // staggered scheduling based on dayOffset + suggestedTime. Posts for
  // unconnected platforms are skipped. This is the "auto-posting" feature
  // promised in the Multi-Service tier.
  async function scheduleAll() {
    if (!batch.generatedPosts || batch.generatedPosts.length === 0) return;
    setScheduling(true);
    let scheduled = 0;
    let failed = 0;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date();

    for (const post of batch.generatedPosts) {
      const zernioPlatform = SOCIAL_TO_ZERNIO_PLATFORM[post.platform];
      if (!connectedPlatforms.has(zernioPlatform)) continue;

      // Compute schedule time: today + dayOffset days, at suggestedTime or 10:00
      const schedDate = new Date(now);
      schedDate.setDate(schedDate.getDate() + post.dayOffset);
      const [hours, minutes] = (post.suggestedTime ?? "10:00")
        .match(/(\d{1,2}):(\d{2})/)
        ?.slice(1)
        .map(Number) ?? [10, 0];
      schedDate.setHours(hours, minutes, 0, 0);

      // Skip if the date is in the past
      if (schedDate <= now) {
        schedDate.setDate(schedDate.getDate() + 1);
      }

      const hashtagBlock = post.hashtags.length
        ? `\n\n${post.hashtags.map((h: string) => `#${h}`).join(" ")}`
        : "";
      const content = `${post.caption}${hashtagBlock}`;

      try {
        const res = await fetch(
          `/api/sub-accounts/${subAccountId}/zernio/post`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content,
              platforms: [zernioPlatform],
              scheduledFor: schedDate.toISOString(),
              timezone: tz,
            }),
          },
        );
        const data = (await res.json()) as { ok?: boolean };
        if (res.ok && data.ok) scheduled++;
        else failed++;
      } catch {
        failed++;
      }
    }

    setScheduledCount(scheduled);
    setScheduling(false);
    if (failed > 0) {
      toast.success(`Scheduled ${scheduled} posts. ${failed} failed or skipped.`);
    } else {
      toast.success(`Scheduled ${scheduled} posts across your connected platforms.`);
    }
  }

  const publishablePosts = batch.generatedPosts?.filter((p) =>
    connectedPlatforms.has(SOCIAL_TO_ZERNIO_PLATFORM[p.platform]),
  ) ?? [];

  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Generating: {batch.businessProfile?.industry} · {batch.businessProfile?.location}
        </h2>
        <StatusBadge status={batch.status} />
      </div>

      {batch.errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950 p-3 text-sm text-red-900 dark:text-red-200">
          {batch.errorMessage}
        </div>
      )}

      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Progress</span>
          <span>{batch.progress?.completed ?? 0} / {batch.progress?.total ?? 0}</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${pct.toFixed(1)}%` }}
          />
        </div>
      </div>

      {batch.generatedPosts && batch.generatedPosts.length > 0 && (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {batch.generatedPosts
            .slice()
            .sort((a: GeneratedPost, b: GeneratedPost) => a.dayOffset - b.dayOffset)
            .map((p: GeneratedPost, i: number) => (
              <PostCard
                key={`${p.dayOffset}-${p.platform}-${i}`}
                post={p}
                connectedPlatforms={connectedPlatforms}
                subAccountId={subAccountId}
              />
            ))}
        </div>
      )}

      {batch.status === "ready" && (
        <div className="flex flex-wrap gap-3">
          {publishablePosts.length > 0 && (
            <button
              type="button"
              onClick={scheduleAll}
              disabled={scheduling || scheduledCount != null}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {scheduling
                ? "Scheduling…"
                : scheduledCount != null
                  ? `✓ ${scheduledCount} posts scheduled`
                  : `Schedule all ${publishablePosts.length} posts`}
            </button>
          )}
          <button
            type="button"
            onClick={() => downloadCsv(batch)}
            className="h-9 px-4 rounded-md border text-sm font-medium hover:bg-muted/50"
          >
            Export CSV
          </button>
        </div>
      )}
    </div>
  );
}

function PostCard({
  post,
  connectedPlatforms,
  subAccountId,
}: {
  post: GeneratedPost;
  connectedPlatforms: Set<string>;
  subAccountId: string;
}) {
  const platformColors: Record<SocialPlatform, string> = {
    facebook: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    instagram: "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300",
    linkedin: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
    x: "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100",
  };

  // Map the social-content gen platform slug to Zernio's slug.
  const zernioPlatform = SOCIAL_TO_ZERNIO_PLATFORM[post.platform];
  const isConnected = connectedPlatforms.has(zernioPlatform);
  const [publishing, setPublishing] = useState(false);
  const [publishedAt, setPublishedAt] = useState<Date | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);

  async function publish() {
    setPublishing(true);
    try {
      // Body of the post = caption + 1 blank line + hashtags (the platform
      // strips raw text vs. hashtag-block sensibly per its own native UI).
      const hashtagBlock = post.hashtags.length
        ? `\n\n${post.hashtags.map((h) => `#${h}`).join(" ")}`
        : "";
      const content = `${post.caption}${hashtagBlock}`;

      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/zernio/post`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            platforms: [zernioPlatform],
            mediaUrls: generatedImageUrl ? [generatedImageUrl] : undefined,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      setPublishedAt(new Date());
      toast.success(`Published to ${post.platform}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs px-2 py-0.5 rounded-full ${platformColors[post.platform]}`}>
          {post.platform}
        </span>
        <span className="text-xs text-muted-foreground">
          Day {post.dayOffset + 1}
          {post.suggestedTime ? ` · ${post.suggestedTime}` : ""}
        </span>
      </div>
      <div className="whitespace-pre-wrap">{post.caption}</div>
      {post.hashtags.length > 0 && (
        <div className="text-xs text-muted-foreground mt-1">
          {post.hashtags.map((h) => `#${h}`).join(" ")}
        </div>
      )}
      <div className="text-xs text-muted-foreground mt-1 italic">
        Image: {post.imagePrompt}
      </div>
      {generatedImageUrl ? (
        <div className="mt-2 relative rounded-md border overflow-hidden h-32 w-full max-w-xs">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={generatedImageUrl}
            alt="AI generated"
            className="h-full w-full object-cover"
          />
          <button
            type="button"
            onClick={() => setGeneratedImageUrl(null)}
            className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/70 text-white text-xs leading-none"
            aria-label="Remove image"
          >
            ×
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={generatingImage}
          onClick={async () => {
            setGeneratingImage(true);
            try {
              const res = await fetch(
                `/api/sub-accounts/${subAccountId}/images/generate`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ prompt: post.imagePrompt }),
                },
              );
              const data = (await res.json()) as { url?: string; message?: string; error?: string };
              if (!res.ok || !data.url) {
                throw new Error(data.message ?? data.error ?? "Generation failed");
              }
              setGeneratedImageUrl(data.url);
              toast.success("Image generated.");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Image generation failed");
            } finally {
              setGeneratingImage(false);
            }
          }}
          className="mt-1 h-7 px-3 rounded-md border border-dashed text-xs font-medium hover:bg-muted/50 disabled:opacity-50"
        >
          {generatingImage ? "Generating…" : "✨ Generate this image"}
        </button>
      )}
      {post.ctaText && (
        <div className="text-xs font-medium mt-1">CTA: {post.ctaText}</div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        {publishedAt ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            ✓ Published {publishedAt.toLocaleTimeString()}
          </span>
        ) : isConnected ? (
          <button
            type="button"
            onClick={publish}
            disabled={publishing}
            className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50"
          >
            {publishing ? "Publishing…" : "Publish now"}
          </button>
        ) : (
          <a
            href={`/sa/${subAccountId}/social`}
            className="text-xs text-amber-700 dark:text-amber-400 underline"
          >
            Connect {post.platform} to publish
          </a>
        )}
        <span className="text-xs text-muted-foreground">
          Or copy &amp; post manually
        </span>
      </div>
    </div>
  );
}

function downloadCsv(batch: BatchSummary) {
  const rows = [
    ["dayOffset", "platform", "caption", "hashtags", "imagePrompt", "ctaText", "suggestedTime"],
    ...batch.generatedPosts.map((p) => [
      String(p.dayOffset),
      p.platform,
      p.caption.replace(/"/g, '""'),
      p.hashtags.join(" "),
      p.imagePrompt.replace(/"/g, '""'),
      p.ctaText.replace(/"/g, '""'),
      p.suggestedTime ?? "",
    ]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `social-content-${batch.id}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
