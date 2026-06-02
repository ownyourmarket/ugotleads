/**
 * src/lib/cookies/partner-ref.ts
 *
 * Client-side helper for the MyUSA Partner referral cookie.
 *
 * Cookie name : myusa_partner_ref
 * Set by      : landing pages that stamp /?ref=CODE in the URL
 * Purpose     : carry partner referral attribution into checkout so the
 *               referring partner earns a commission on the sale
 *
 * ── Separation of concerns ───────────────────────────────────────────────────
 * This is the MYUSA partner referral system.
 * Do NOT confuse with the `ls_ref` cookie or `referrals` Firestore collection
 * which belong to the LeadStack founders-cohort affiliate program.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   import { readPartnerRefCookie, clearPartnerRefCookie } from "@/lib/cookies/partner-ref";
 *
 *   const code = readPartnerRefCookie(); // "ABC123" | null
 *
 * This file is safe to import in "use client" components. It does not import
 * any server-only modules.
 */

const COOKIE_NAME = "myusa_partner_ref";

/**
 * Reads the myusa_partner_ref cookie from document.cookie.
 * Returns null when called server-side (no document) or when the cookie is absent.
 */
export function readPartnerRefCookie(): string | null {
  if (typeof document === "undefined") return null;

  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));

  if (!match) return null;

  const raw = match.slice(COOKIE_NAME.length + 1);
  const decoded = decodeURIComponent(raw).trim();
  // Reject empty strings or obviously invalid codes
  return decoded.length > 0 ? decoded : null;
}

/**
 * Clears the myusa_partner_ref cookie across common path/domain combos.
 * Call after a successful checkout redirect to prevent double attribution.
 */
export function clearPartnerRefCookie(): void {
  if (typeof document === "undefined") return;
  const expires = "expires=Thu, 01 Jan 1970 00:00:00 UTC";
  document.cookie = `${COOKIE_NAME}=; ${expires}; path=/`;
}
