import "server-only";
import { randomBytes } from "crypto";

/** Commission rate for the founders program. Whole-number percent. */
export const COMMISSION_PCT = 40;

/**
 * Produces a human-readable code like "ben-4ec063" from the buyer email.
 * Strategy: lowercase the email's local-part, strip non-alphanumerics,
 * truncate to 16 chars, suffix with 6 hex chars so two different "ben@..."
 * accounts don't collide.
 *
 * The hex suffix is collision-resistant enough for our scale (50 founders
 * cohort, modest growth after); we don't bother with a uniqueness check
 * loop because 16^6 ≈ 16M possibilities per local-part.
 */
export function generateAffiliateCode(email: string): string {
  const local = email.split("@")[0] ?? "user";
  const slug = local
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16) || "user";
  const suffix = randomBytes(3).toString("hex"); // 6 hex chars
  return `${slug}-${suffix}`;
}

/**
 * Computes the commission owed in cents. Floor to avoid fractional cents.
 * Returns 0 if amountPaidCents is null or non-positive — defensive guard
 * against malformed Stripe payloads.
 */
export function commissionForAmount(amountPaidCents: number | null): number {
  if (typeof amountPaidCents !== "number" || amountPaidCents <= 0) return 0;
  return Math.floor((amountPaidCents * COMMISSION_PCT) / 100);
}
