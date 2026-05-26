import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { sendEmail, emailIsConfigured } from "@/lib/comms/resend";

/**
 * Cap-usage warning emails.
 *
 * Fires two threshold notifications per billing period per sub-account:
 *   - 80% of cap reached
 *   - 100% of cap reached (AI replies start falling back to canned text)
 *
 * Idempotent: a `aiUsage.warningsSent` bitmask field records which
 * thresholds we've already emailed for the current period. The monthly
 * reset cron clears `lastWarningAt`; we also use that as a "fresh
 * period" signal to re-arm both thresholds.
 *
 * Best-effort: invoked from the resolver's recordUsage callback. If
 * Resend isn't configured or the send fails, we log + move on; we never
 * block AI replies on email-send latency.
 */

const THRESHOLDS: { pct: number; label: "80" | "100" }[] = [
  { pct: 0.8, label: "80" },
  { pct: 1.0, label: "100" },
];

interface MaybeWarnArgs {
  subAccountId: string;
  newUsage: number;
  capTokens: number;
}

/**
 * Call after a successful recordUsage(). Resolves quickly: at most one
 * Firestore read + one email send per crossed threshold.
 */
export async function maybeSendCapWarning(args: MaybeWarnArgs): Promise<void> {
  const { subAccountId, newUsage, capTokens } = args;
  if (capTokens <= 0) return;
  const usagePct = newUsage / capTokens;
  // Find the highest threshold we just crossed.
  const crossed = THRESHOLDS.filter((t) => usagePct >= t.pct);
  if (crossed.length === 0) return;

  if (!emailIsConfigured()) {
    // No Resend wired — silently skip. We still bump the "warning sent"
    // marker so we don't hammer Firestore checking on every call.
    return;
  }

  const db = getAdminDb();
  const ref = db.doc(`subAccounts/${subAccountId}`);
  const snap = await ref.get();
  const data = snap.data();
  if (!data) return;

  // Resolve operator notification email. Priority order:
  //   1. agency owner email (read from agencies/{agencyId})
  //   2. fallback to nothing → skip
  let recipient: string | null = null;
  try {
    const agencyDoc = await db.doc(`agencies/${data.agencyId}`).get();
    const ownerUid = agencyDoc.data()?.ownerUid;
    if (ownerUid) {
      const userDoc = await db.doc(`users/${ownerUid}`).get();
      recipient = userDoc.data()?.email ?? null;
    }
  } catch {
    /* swallow — best-effort */
  }
  if (!recipient) {
    console.warn(
      `[cap-warning] no recipient for sa=${subAccountId} (skipping)`,
    );
    return;
  }

  const sent: string[] = data.aiUsage?.warningsSentThisPeriod ?? [];
  for (const t of crossed) {
    if (sent.includes(t.label)) continue;
    try {
      await sendOne({
        recipient,
        subAccountName: data.name ?? "your workspace",
        threshold: t.label,
        used: newUsage,
        cap: capTokens,
      });
      // Mark threshold as sent so we don't re-send on the next call.
      await ref.set(
        {
          aiUsage: {
            warningsSentThisPeriod: [...sent, t.label],
            lastWarningAt: Timestamp.now(),
          },
        },
        { merge: true },
      );
      sent.push(t.label);
    } catch (err) {
      console.error(
        `[cap-warning] send failed sa=${subAccountId} threshold=${t.label}:`,
        err,
      );
    }
  }
}

async function sendOne(args: {
  recipient: string;
  subAccountName: string;
  threshold: "80" | "100";
  used: number;
  cap: number;
}): Promise<void> {
  const pct = Math.round((args.used / args.cap) * 100);
  const subject =
    args.threshold === "80"
      ? `Heads up — AI usage at ${pct}% for "${args.subAccountName}"`
      : `AI cap reached for "${args.subAccountName}" — replies are falling back`;

  const body80 = `Hi,

Your AI usage for "${args.subAccountName}" is at ${pct}% of your monthly cap (${args.used.toLocaleString()} / ${args.cap.toLocaleString()} tokens).

You've still got headroom this period, but if you're trending high:
  • Upgrade your tier (each tier increases the cap 5x)
  • Or add your own OpenRouter key in Settings → AI Provider → BYOK for unlimited usage

You can see live usage at any time:
${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.ugotleads.io"}/sa/SUB_ID/settings/ai-provider

— UGotLeads`;

  const body100 = `Hi,

Your AI usage for "${args.subAccountName}" has reached this month's cap (${args.used.toLocaleString()} / ${args.cap.toLocaleString()} tokens).

What happens now: AI replies (Web Chat, SMS auto-reply, content gen) fall back to a friendly "someone will get back to you" message. No surprise bill — your cap is hard.

To unblock AI replies:
  • Upgrade your tier (each tier increases the cap 5x)
  • Or add your own OpenRouter key in Settings → AI Provider → BYOK for unlimited usage at no platform markup

Manage AI provider:
${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.ugotleads.io"}/sa/SUB_ID/settings/ai-provider

— UGotLeads`;

  await sendEmail({
    to: args.recipient,
    subject,
    text: args.threshold === "80" ? body80 : body100,
  });
}
