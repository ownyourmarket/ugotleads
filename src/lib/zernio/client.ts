import "server-only";

/**
 * Zernio thin client. Zernio is the unified social-API provider that
 * handles per-platform OAuth, token storage, publishing, retries, and
 * engagement webhooks — so UGotLeads never touches platform tokens
 * directly and the operator gets a real "Connect Facebook" flow.
 *
 * Each UGotLeads sub-account is paired 1:1 with a Zernio Profile.
 * Profile id is stored at `subAccounts/{id}.zernioProfileId`.
 *
 * Docs: https://docs.zernio.com/
 */

const API_BASE =
  process.env.ZERNIO_API_URL?.replace(/\/$/, "") || "https://api.zernio.com/v1";

export function zernioIsConfigured(): boolean {
  return !!process.env.ZERNIO_API_KEY;
}

function requireKey(): string {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) {
    throw new Error(
      "ZERNIO_API_KEY not set. Configure it in Vercel env and redeploy.",
    );
  }
  return key;
}

async function zernioFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ZernioError(
      `Zernio ${res.status}: ${body.slice(0, 400) || res.statusText}`,
      res.status,
      body,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class ZernioError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "ZernioError";
  }
}

// ── Profiles (one per UGotLeads sub-account) ─────────────────────────────

export interface ZernioProfile {
  _id: string;
  name: string;
  color?: string;
  isDefault?: boolean;
  accountUsernames?: string[];
  createdAt: string;
  updatedAt: string;
}

export async function listProfiles(): Promise<ZernioProfile[]> {
  const data = await zernioFetch<{ profiles: ZernioProfile[] }>("/profiles");
  return data.profiles;
}

export async function createProfile(args: {
  name: string;
  description?: string;
}): Promise<ZernioProfile> {
  return zernioFetch<ZernioProfile>("/profiles", {
    method: "POST",
    body: JSON.stringify({
      name: args.name,
      description: args.description,
    }),
  });
}

export async function deleteProfile(profileId: string): Promise<void> {
  await zernioFetch(`/profiles/${profileId}`, { method: "DELETE" });
}

// ── Accounts (per-platform connections under a profile) ──────────────────

export interface ZernioAccount {
  _id: string;
  profileId: string;
  platform: string;
  username?: string;
  displayName?: string;
  isActive: boolean;
  connectedAt: string;
  [key: string]: unknown;
}

export async function listAccounts(profileId: string): Promise<ZernioAccount[]> {
  const data = await zernioFetch<{ accounts: ZernioAccount[] }>(
    `/accounts?profileId=${encodeURIComponent(profileId)}`,
  );
  return data.accounts;
}

// ── Connect URLs (per-platform OAuth handshake) ──────────────────────────

/**
 * Platform slugs verified against docs.zernio.com/llms-full.txt:
 *   ✓ facebook, instagram, linkedin, twitter, tiktok, youtube,
 *     pinterest, threads, bluesky
 *   ? reddit, gmb, telegram, snapchat, whatsapp, discord — not explicitly
 *     enumerated in the LLM-readable docs; verify against /v1/connect/
 *     before exposing in the UI. If a slug 404s the API returns a clear
 *     error which the connect route surfaces to the operator.
 */
export type ZernioPlatform =
  | "facebook"
  | "instagram"
  | "linkedin"
  | "twitter"
  | "tiktok"
  | "youtube"
  | "pinterest"
  | "threads"
  | "reddit"
  | "bluesky"
  | "gmb"
  | "telegram"
  | "snapchat"
  | "whatsapp"
  | "discord";

/**
 * Verified against the live Zernio API 2026-05-27 — response shape is
 * `{ authUrl: string, state: string }`, NOT `{ url }`. The `state`
 * payload encodes Zernio's own return URL (their dashboard); the
 * `redirectUri` query param is NOT honored as a way to send the
 * operator back to your app. After authorizing, the operator lands on
 * the Zernio dashboard. Your `account.connected` webhook is what tells
 * you the connection succeeded — you can use that to update your UI
 * even though the operator's browser isn't back on your app yet.
 *
 * If a smoother UX is needed (operator lands back inside UGotLeads), we
 * can either (a) instruct operators to close the tab, (b) open the
 * Connect flow in a popup we control, or (c) ask Zernio support for a
 * customReturnUrl feature. Punted from Phase 1.
 */
export async function getConnectUrl(args: {
  platform: ZernioPlatform;
  profileId: string;
  redirectUri?: string;
}): Promise<{ url: string }> {
  const params = new URLSearchParams({ profileId: args.profileId });
  if (args.redirectUri) params.set("redirectUri", args.redirectUri);
  const raw = await zernioFetch<{ authUrl?: string; url?: string }>(
    `/connect/${args.platform}?${params.toString()}`,
  );
  const url = raw.authUrl ?? raw.url;
  if (!url) {
    throw new Error("Zernio returned no auth URL for this platform");
  }
  return { url };
}

// ── Posts (publish + schedule) ───────────────────────────────────────────

/**
 * Publish-post shape per docs.zernio.com/llms-full.txt:
 *   { content: <string>, scheduledFor?: <ISO>, timezone?: <IANA>,
 *     platforms: [{ platform, accountId, customContent?, platformSpecificData? }],
 *     mediaItems?: [{ type: "image"|"video", url }] }
 *
 * Notes:
 *   - `content` is a flat string (not an object)
 *   - Media is `mediaItems[]` separate from content (not nested mediaUrls)
 *   - Per-platform overrides go in `customContent` per platforms[] entry
 *   - Bluesky's 300-char cap is the #1 cause of failed cross-posts —
 *     when targeting Bluesky alongside longer-form platforms, use
 *     `customContent` on the Bluesky platforms[] entry to ship a
 *     shorter variant.
 */
export interface ZernioPublishInput {
  content: string;
  platforms: Array<{
    platform: ZernioPlatform;
    accountId: string;
    customContent?: string;
    platformSpecificData?: Record<string, unknown>;
  }>;
  mediaItems?: Array<{ type: "image" | "video"; url: string }>;
  scheduledFor?: string;
  timezone?: string;
}

export interface ZernioPost {
  _id: string;
  profileId?: string;
  status: "scheduled" | "publishing" | "published" | "failed" | "partial";
  scheduledFor?: string;
  publishedAt?: string;
  perAccount?: Array<{
    accountId: string;
    platform: string;
    status: string;
    platformPostId?: string;
    error?: string;
  }>;
  [key: string]: unknown;
}

export async function createPost(input: ZernioPublishInput): Promise<ZernioPost> {
  return zernioFetch<ZernioPost>("/posts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
