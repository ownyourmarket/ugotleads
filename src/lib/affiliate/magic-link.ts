import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Reuses the existing AUTOMATIONS_TOKEN_SECRET so affiliate tokens can be
 * rotated alongside unsubscribe links — one knob, predictable blast radius.
 * Rotating the secret invalidates every in-flight magic link AND every
 * active affiliate session by design.
 */
function getSecret(): string {
  const secret = process.env.AUTOMATIONS_TOKEN_SECRET;
  if (!secret) {
    throw new Error(
      "AUTOMATIONS_TOKEN_SECRET is not set — required to sign affiliate session tokens.",
    );
  }
  return secret;
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): Buffer {
  const pad = str.length % 4;
  const padded = pad ? str + "=".repeat(4 - pad) : str;
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(payload: string): string {
  return base64UrlEncode(
    createHmac("sha256", getSecret()).update(payload).digest(),
  );
}

interface TokenPayload {
  /** Affiliate doc id — opaque, server-issued. */
  aid: string;
  /** Email at the time of issue. Stored for revocation if email changes. */
  e: string;
  /** Expiration epoch ms. */
  exp: number;
  /** "ml" = magic link (one-time, 15min); "ses" = session cookie (30d). */
  k: "ml" | "ses";
}

function encodeToken(payload: TokenPayload): string {
  const body = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf-8"));
  const sig = sign(body);
  return `${body}.${sig}`;
}

function decodeToken(token: string): TokenPayload | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(body);
  // timingSafeEqual requires equal-length buffers — guard explicitly.
  if (expected.length !== sig.length) return null;
  try {
    if (
      !timingSafeEqual(Buffer.from(expected, "utf-8"), Buffer.from(sig, "utf-8"))
    ) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const json = base64UrlDecode(body).toString("utf-8");
    const parsed = JSON.parse(json) as TokenPayload;
    if (
      typeof parsed.aid !== "string" ||
      typeof parsed.e !== "string" ||
      typeof parsed.exp !== "number" ||
      (parsed.k !== "ml" && parsed.k !== "ses")
    ) {
      return null;
    }
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function signMagicLinkToken(affiliateId: string, email: string): string {
  return encodeToken({
    aid: affiliateId,
    e: email.trim().toLowerCase(),
    exp: Date.now() + MAGIC_LINK_TTL_MS,
    k: "ml",
  });
}

export function signSessionToken(affiliateId: string, email: string): string {
  return encodeToken({
    aid: affiliateId,
    e: email.trim().toLowerCase(),
    exp: Date.now() + SESSION_TTL_MS,
    k: "ses",
  });
}

export function verifyMagicLinkToken(token: string): { affiliateId: string; email: string } | null {
  const payload = decodeToken(token);
  if (!payload || payload.k !== "ml") return null;
  return { affiliateId: payload.aid, email: payload.e };
}

export function verifySessionToken(token: string): { affiliateId: string; email: string } | null {
  const payload = decodeToken(token);
  if (!payload || payload.k !== "ses") return null;
  return { affiliateId: payload.aid, email: payload.e };
}

export const AFFILIATE_SESSION_COOKIE = "ls_aff_session";
export const AFFILIATE_SESSION_MAX_AGE_SECONDS = Math.floor(
  SESSION_TTL_MS / 1000,
);
