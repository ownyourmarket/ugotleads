import "server-only";

import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { findAffiliateByCode } from "@/lib/affiliate/account";

const BOT_UA_PATTERN =
  /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|fetch|http\s?client|wget|curl|postman|insomnia/i;

interface RecordClickInput {
  code: string;
  ip: string | null;
  userAgent: string | null;
  landingPath: string;
  referrer: string | null;
}

type RecordClickOutcome =
  | { status: "recorded"; dayKey: string }
  | { status: "skipped"; reason: string };

/**
 * Records one affiliate click. Doc id is deterministic on (dayKey, ipHash,
 * code) so repeat visits from the same visitor on the same day collapse
 * into one row — the .create() throws ALREADY_EXISTS (6) on dup, which we
 * treat as "already counted, no-op".
 *
 * Bot filter: cheap user-agent regex. Real bots are happy to spoof UAs,
 * but this catches the obvious ones (crawlers, link unfurlers, scripts)
 * and stops them from inflating numbers.
 *
 * IP hashing: SHA-256 with the existing AUTOMATIONS_TOKEN_SECRET as salt.
 * Rotating that secret resets the dedup horizon (existing rows stay but
 * new visits create new docs because the hash changes). Acceptable for
 * our use case — affiliate analytics, not forensic logging.
 */
export async function recordClick({
  code,
  ip,
  userAgent,
  landingPath,
  referrer,
}: RecordClickInput): Promise<RecordClickOutcome> {
  const trimmedCode = code.trim();
  if (!trimmedCode) return { status: "skipped", reason: "empty_code" };

  const ua = (userAgent ?? "").slice(0, 500);
  if (BOT_UA_PATTERN.test(ua)) {
    return { status: "skipped", reason: "bot_ua" };
  }

  // Validate the code resolves to an actual affiliate before writing —
  // stops random `?ref=garbage` traffic from filling Firestore.
  const affiliate = await findAffiliateByCode(trimmedCode);
  if (!affiliate) return { status: "skipped", reason: "unknown_code" };
  if (affiliate.status !== "active") {
    return { status: "skipped", reason: `affiliate_${affiliate.status}` };
  }

  const secret = process.env.AUTOMATIONS_TOKEN_SECRET ?? "no-salt";
  const ipHash = createHash("sha256")
    .update(`${secret}:${ip ?? "no-ip"}`)
    .digest("hex");
  const ipHashPrefix = ipHash.slice(0, 12);

  const now = new Date();
  const dayKey = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;

  // Deterministic doc id: one row per (day, ip, code). Repeat visits dedupe.
  const docId = `${dayKey}-${ipHashPrefix}-${trimmedCode}`.slice(0, 1500);

  const db = getAdminDb();
  try {
    await db.collection("clicks").doc(docId).create({
      affiliateCode: trimmedCode,
      ipHash,
      userAgent: ua,
      landingPath: landingPath.slice(0, 500),
      referrer: referrer ? referrer.slice(0, 500) : null,
      dayKey,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 6) {
      return { status: "skipped", reason: "duplicate_today" };
    }
    throw err;
  }

  return { status: "recorded", dayKey };
}

/**
 * Counts clicks for a single affiliate code. Used by the admin dashboard
 * to show the funnel (clicks → referrals → commission). Capped reads via
 * Firestore .count() — cheap, no documents materialized.
 */
export async function countClicksForCode(code: string): Promise<number> {
  const snap = await getAdminDb()
    .collection("clicks")
    .where("affiliateCode", "==", code.trim())
    .count()
    .get();
  return snap.data().count;
}
