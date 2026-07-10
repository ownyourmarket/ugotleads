import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Per-contact reply-to tokens for outbound_sequence sends. Format:
 *
 *   `${contactId}.${first-12-hex-chars-of-HMAC-SHA256(contactId, AUTOMATIONS_TOKEN_SECRET)}`
 *
 * Mirrors the unsubscribe-token pattern (same file, same secret) but
 * truncates the HMAC to 12 lowercase hex chars — the reply address is
 * visible to every recipient and gets echoed back in email headers, so a
 * shorter token keeps `reply+<token>@domain` reasonably compact while
 * still giving 48 bits of forgery resistance, plenty for this threat
 * model (stopping a contact's sequence / spoofing a reply match, not
 * protecting secret data).
 *
 * Rotating AUTOMATIONS_TOKEN_SECRET invalidates every outstanding token,
 * same as the unsubscribe link. Acceptable at v1 scale.
 */

const HMAC_HEX_LENGTH = 12;

/**
 * Resolves the shared token secret. Returns "" (never throws) when unset
 * or too short — callers must treat an empty secret as "tokens
 * unavailable" and degrade gracefully:
 *   - buildReplyToken returns null so resolveSequenceReplyTo can fall
 *     back to subAccountReplyTo instead of emitting a bogus address.
 *   - verifyReplyToken returns null (no match) rather than ever matching
 *     against an empty-secret HMAC.
 * This differs from unsubscribe-token.ts's getSecret(), which throws —
 * unsubscribe links are user-facing and a hard failure surfaces the
 * misconfiguration immediately. Reply-to routing sits on the hot send
 * path for every sequence step, so we prefer "degrade to the
 * sub-account's plain reply-to" over crashing every send in an
 * environment where the secret isn't configured yet.
 */
function getSecret(): string {
  const s = process.env.AUTOMATIONS_TOKEN_SECRET;
  if (!s || s.length < 16) return "";
  return s;
}

function computeHmac12(contactId: string, secret: string): string {
  return createHmac("sha256", secret).update(contactId).digest("hex").slice(0, HMAC_HEX_LENGTH);
}

/**
 * Builds a `${contactId}.${hmac12}` reply token, or null when the secret
 * isn't configured or the contactId contains a "." (would break parsing
 * on verify). Never throws.
 */
export function buildReplyToken(contactId: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(contactId)) return null;
  return `${contactId}.${computeHmac12(contactId, secret)}`;
}

/**
 * Returns the contactId if the token is valid, or null otherwise
 * (malformed, tampered, or secret unset/empty). Uses a timing-safe
 * compare to thwart token-recovery via response-time analysis. Never
 * throws.
 */
export function verifyReplyToken(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const contactId = token.slice(0, dot);
  const hmac = token.slice(dot + 1);
  if (hmac.length !== HMAC_HEX_LENGTH) return null;

  const secret = getSecret();
  if (!secret) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(contactId)) return null;

  const expected = computeHmac12(contactId, secret);
  const a = Buffer.from(hmac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? contactId : null;
}
