import "server-only";

import crypto from "crypto";

const SECRET =
  process.env.AUTOMATIONS_TOKEN_SECRET || process.env.COOKIE_SECRET_CURRENT || "";

// 1x1 transparent GIF (43 bytes)
export const TRACKING_PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

/* ── Token helpers ──────────────────────────────────────── */

interface TrackingPayload {
  /** Contact ID — used to write the activity */
  cid: string;
  /** Context type: "broadcast" | "automation" | "manual" */
  ctx: string;
  /** Context ID (broadcastId or automationExecutionId) */
  ref: string;
}

/**
 * Build an HMAC-signed tracking token encoding the contact + context.
 * Format: base64url(JSON) + "." + hex(hmac)
 */
export function buildTrackingToken(payload: TrackingPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const hmac = crypto
    .createHmac("sha256", SECRET)
    .update(data)
    .digest("hex")
    .slice(0, 16); // 16 hex chars is sufficient for anti-forgery
  return `${data}.${hmac}`;
}

/**
 * Verify and decode a tracking token. Returns null if invalid.
 */
export function verifyTrackingToken(
  token: string,
): TrackingPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(data)
    .digest("hex")
    .slice(0, 16);
  if (sig !== expected) return null;

  try {
    return JSON.parse(
      Buffer.from(data, "base64url").toString("utf-8"),
    ) as TrackingPayload;
  } catch {
    return null;
  }
}

/* ── HTML injection ─────────────────────────────────────── */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * Build the tracking pixel <img> tag for a given token.
 */
function pixelUrl(token: string): string {
  return `${APP_URL}/api/track/open/${token}`;
}

/**
 * Build a click-tracking redirect URL. The original URL is encoded in the
 * query string (not the token) so different links in the same email get
 * distinct tracking without needing separate tokens.
 */
function clickUrl(token: string, originalUrl: string): string {
  return `${APP_URL}/api/track/click/${token}?url=${encodeURIComponent(originalUrl)}`;
}

/**
 * Inject a tracking pixel and rewrite links in an HTML email body.
 *
 * - Appends a 1x1 invisible image before </body> for open tracking
 * - Rewrites <a href="..."> links to pass through the click tracker
 * - Skips rewriting unsubscribe links (they contain /u/ in the path)
 *   and mailto: links
 */
export function injectTracking(
  html: string,
  payload: TrackingPayload,
): string {
  const token = buildTrackingToken(payload);

  // 1. Rewrite links (before injecting the pixel — pixel has no href)
  const rewritten = html.replace(
    /<a\s([^>]*?)href="(https?:\/\/[^"]+)"([^>]*?)>/gi,
    (_match, before: string, href: string, after: string) => {
      // Don't rewrite unsubscribe links — the HMAC signature would break
      if (href.includes("/u/") || href.includes("/api/u/")) return _match;
      return `<a ${before}href="${clickUrl(token, href)}"${after}>`;
    },
  );

  // 2. Inject tracking pixel before </body>
  const pixel = `<img src="${pixelUrl(token)}" width="1" height="1" style="display:block;width:1px;height:1px;border:0;" alt="" />`;

  if (rewritten.includes("</body>")) {
    return rewritten.replace("</body>", `${pixel}</body>`);
  }
  // Fallback: append at the end
  return rewritten + pixel;
}
