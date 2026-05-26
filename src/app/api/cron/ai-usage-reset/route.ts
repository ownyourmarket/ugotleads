import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { verifyQStashSignature } from "@/lib/automations/qstash";

/**
 * POST /api/cron/ai-usage-reset
 *
 * Daily QStash-scheduled job that rolls over AI usage periods.
 *
 * For every sub-account whose `aiUsage.currentPeriodStart` is at least
 * 30 days in the past:
 *   1. Snapshot the closing period to `usage/{saId}/aiBilling/{YYYY-MM}`
 *      (server-only collection, dedup'd by month).
 *   2. Atomically zero `aiUsage.currentPeriodTokens` and advance
 *      `aiUsage.currentPeriodStart = now`.
 *   3. Leave `lifetimeTokens` untouched.
 *   4. Leave `monthlyCapTokens` untouched — tier-driven cap refresh is a
 *      separate hook (Stripe webhook) so this job stays simple and idempotent.
 *
 * Idempotency:
 *   - The snapshot doc id is the closing period's "YYYY-MM" key. A second
 *     run on the same day finds the doc already exists and skips.
 *   - The reset write is conditional: we only reset if currentPeriodStart
 *     hasn't already been advanced past the threshold.
 *
 * Security:
 *   - Public path (middleware bypass); auth is the Upstash-Signature header.
 *
 * Schedule setup:
 *   Create a daily schedule in Upstash QStash dashboard pointing at
 *   `${NEXT_PUBLIC_APP_URL}/api/cron/ai-usage-reset` with cron `0 3 * * *`
 *   (03:00 UTC daily). Body can be empty `{}`.
 */

const PERIOD_DAYS = 30;
const PERIOD_MS = PERIOD_DAYS * 24 * 60 * 60 * 1000;
// Hard cap on docs processed per run so a single invocation doesn't blow the
// 60s Vercel limit. With 100/run + daily schedule we'd handle 36,500 sub-
// accounts before the next run laps us. Plenty of headroom.
const MAX_PER_RUN = 100;

interface ResetStats {
  scanned: number;
  resetCount: number;
  skippedRecent: number;
  errors: number;
}

export async function POST(request: Request) {
  // QStash signature gate.
  const signature = request.headers.get("upstash-signature");
  const rawBody = await request.text();
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 401 });
  }
  const valid = await verifyQStashSignature(signature, rawBody);
  if (!valid) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const db = getAdminDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - PERIOD_MS);

  // Find candidates. We can't index on aiUsage.currentPeriodStart without
  // adding a Firestore composite index; this runs daily over a small set
  // (<10K sub-accounts in v1) so a collection scan with limit is fine.
  const snap = await db
    .collection("subAccounts")
    .where("aiUsage.currentPeriodStart", "<=", Timestamp.fromDate(cutoff))
    .limit(MAX_PER_RUN)
    .get();

  const stats: ResetStats = {
    scanned: snap.size,
    resetCount: 0,
    skippedRecent: 0,
    errors: 0,
  };

  for (const doc of snap.docs) {
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        const data = fresh.data();
        const usage = data?.aiUsage;
        if (!usage) {
          stats.skippedRecent += 1;
          return;
        }
        const periodStart =
          usage.currentPeriodStart instanceof Timestamp
            ? usage.currentPeriodStart.toDate()
            : usage.currentPeriodStart instanceof Date
              ? usage.currentPeriodStart
              : new Date();
        if (periodStart > cutoff) {
          // Another process / earlier run already advanced this one.
          stats.skippedRecent += 1;
          return;
        }

        const periodEnd = new Date(periodStart.getTime() + PERIOD_MS);
        const periodKey = `${periodEnd.getUTCFullYear()}-${String(periodEnd.getUTCMonth() + 1).padStart(2, "0")}`;
        const snapshotRef = db.doc(
          `usage/${doc.id}/aiBilling/${periodKey}`,
        );

        // Snapshot the closing period. Use `create()` semantics so a re-
        // run on the same day silently no-ops (already exists → error;
        // we swallow it because reset has already happened).
        const existing = await tx.get(snapshotRef);
        if (!existing.exists) {
          tx.set(snapshotRef, {
            subAccountId: doc.id,
            agencyId: data?.agencyId ?? null,
            periodStart: Timestamp.fromDate(periodStart),
            periodEnd: Timestamp.fromDate(periodEnd),
            tokensUsed: usage.currentPeriodTokens ?? 0,
            capTokens: usage.monthlyCapTokens ?? 0,
            capExceeded:
              (usage.currentPeriodTokens ?? 0) >=
              (usage.monthlyCapTokens ?? Number.MAX_SAFE_INTEGER),
            mode: data?.aiProvider?.mode ?? "hosted",
            closedAt: Timestamp.now(),
          });
        }

        tx.update(doc.ref, {
          "aiUsage.currentPeriodTokens": 0,
          "aiUsage.currentPeriodStart": Timestamp.fromDate(now),
          // monthlyCapTokens intentionally left as-is (tier-refresh is a
          // separate concern handled by the Stripe webhook).
          "aiUsage.lastWarningAt": null,
        });
      });
      stats.resetCount += 1;
    } catch (err) {
      stats.errors += 1;
      console.error(
        `[cron/ai-usage-reset] failed for sa=${doc.id}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.info(
    `[cron/ai-usage-reset] scanned=${stats.scanned} reset=${stats.resetCount} skipped=${stats.skippedRecent} errors=${stats.errors}`,
  );

  return NextResponse.json({ ok: true, ...stats });
}
