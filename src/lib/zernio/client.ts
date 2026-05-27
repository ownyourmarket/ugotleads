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
  color?: string;
}): Promise<ZernioProfile> {
  return zernioFetch<ZernioProfile>("/profiles", {
    method: "POST",
    body: JSON.stringify({ name: args.name, color: args.color }),
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

export async function getConnectUrl(args: {
  platform: ZernioPlatform;
  profileId: string;
  /** Where to send the operator after they authorize. */
  redirectUri?: string;
}): Promise<{ url: string }> {
  const params = new URLSearchParams({ profileId: args.profileId });
  if (args.redirectUri) params.set("redirectUri", args.redirectUri);
  return zernioFetch<{ url: string }>(
    `/connect/${args.platform}?${params.toString()}`,
  );
}

// ── Posts (publish + schedule) ───────────────────────────────────────────

export interface ZernioPublishInput {
  profileId: string;
  accountIds: string[];
  content: {
    text?: string;
    mediaUrls?: string[];
  };
  scheduledFor?: string;
}

export interface ZernioPost {
  _id: string;
  profileId: string;
  status: "scheduled" | "publishing" | "published" | "failed" | "partial";
  scheduledFor?: string;
  publishedAt?: string;
  perAccount: Array<{
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
