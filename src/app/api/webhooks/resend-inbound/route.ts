import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { verifySvixSignature } from "@/lib/webhooks/svix-verify";
import { verifyReplyToken } from "@/lib/automations/reply-token";
import { emailIsConfigured, sendEmail } from "@/lib/comms/resend";
import type { InboundEmailDoc } from "@/types/inbound-emails";

export const dynamic = "force-dynamic";

/**
 * Resend inbound email webhook — the human-reply side of outbound
 * sequences. Faces the open internet; every request is svix-signature
 * verified (Task 8) before any Firestore access. Once the signature
 * checks out, the route always answers 200 (Resend must not retry
 * forever on our bugs) — 401 is reserved for bad/missing signatures,
 * 503 for missing config.
 *
 * Behavior:
 *  1. Match the reply to a contact — a `reply+<contactId>@…` address in
 *     `to` wins outright (verified against a real contact); otherwise
 *     fall back to a unique from-email lookup.
 *  2. Always store the parsed event as an `inbound_emails` doc, keyed by
 *     Resend's `email_id` when present so replays overwrite in place.
 *  3. If matched: log an `email_reply` activity, stop every RUNNING
 *     outbound_sequence execution for that contact (a reply means the
 *     cold sequence did its job — no more automated follow-ups), and
 *     forward a copy to the sub-account's human inbox when configured.
 */

function extractEmail(v: unknown): string {
  if (typeof v === "string") {
    const m = /<([^>]+)>/.exec(v);
    return (m ? m[1] : v).trim().toLowerCase();
  }
  if (
    v &&
    typeof v === "object" &&
    typeof (v as { email?: unknown }).email === "string"
  ) {
    return (v as { email: string }).email.trim().toLowerCase();
  }
  return "";
}

function extractAddresses(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(extractEmail).filter(Boolean);
  const one = extractEmail(v);
  return one ? [one] : [];
}

/** Best-effort string form of the raw `data.from` value, for audit storage. */
function rawFromString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return "";
    }
  }
  return "";
}

interface ContactMatch {
  contactId: string;
  matchedBy: "reply_token" | "email_lookup";
  subAccountId: string | null;
  agencyId: string | null;
}

/**
 * Behavior 5: reply-token address wins outright (HMAC-verified, then
 * checked against a real contact); otherwise fall back to a unique
 * from-email lookup. Zero or ambiguous (>1) from-email hits leave the
 * reply unmatched. An invalid/tampered HMAC is indistinguishable from "no
 * token present" — it falls through to the from-email fallback exactly
 * like an unmatched address, never treated as an error. No legacy plain
 * contact-ID format is accepted (feature is unreleased).
 */
async function matchContact(
  db: FirebaseFirestore.Firestore,
  toAddresses: string[],
  fromEmail: string
): Promise<ContactMatch | null> {
  let tokenCandidate: string | null = null;
  for (const addr of toAddresses) {
    const m = /^reply\+([A-Za-z0-9]+\.[a-f0-9]{12})@/i.exec(addr);
    if (m) {
      tokenCandidate = m[1];
      break;
    }
  }
  const verifiedContactId = tokenCandidate
    ? verifyReplyToken(tokenCandidate)
    : null;
  if (verifiedContactId) {
    const snap = await db.doc(`contacts/${verifiedContactId}`).get();
    if (snap.exists) {
      const data = snap.data() as Record<string, unknown> | undefined;
      return {
        contactId: verifiedContactId,
        matchedBy: "reply_token",
        subAccountId: (data?.subAccountId as string | undefined) ?? null,
        agencyId: (data?.agencyId as string | undefined) ?? null,
      };
    }
  }

  if (!fromEmail) return null;
  const lookup = await db
    .collection("contacts")
    .where("email", "==", fromEmail)
    .limit(2)
    .get();
  if (lookup.size === 1) {
    const doc = lookup.docs[0];
    const data = doc.data() as Record<string, unknown>;
    return {
      contactId: doc.id,
      matchedBy: "email_lookup",
      subAccountId: (data.subAccountId as string | undefined) ?? null,
      agencyId: (data.agencyId as string | undefined) ?? null,
    };
  }
  return null;
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[resend-inbound] RESEND_INBOUND_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const ok = verifySvixSignature({
    secret,
    id: request.headers.get("svix-id") ?? "",
    timestamp: request.headers.get("svix-timestamp") ?? "",
    signature: request.headers.get("svix-signature") ?? "",
    body: rawBody,
  });
  if (!ok)
    return NextResponse.json({ error: "bad signature" }, { status: 401 });

  // JSON.parse can legitimately return null (raw body "null") or another
  // non-object primitive — guard the shape before touching properties, or
  // `event.type` throws OUTSIDE the try/catch below → uncaught 500,
  // violating the never-throw/always-200 contract.
  let event: { type?: string; data?: Record<string, unknown> } | null;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true, ignored: true });
  }
  if (
    !event ||
    typeof event !== "object" ||
    event.type !== "email.received" ||
    !event.data ||
    typeof event.data !== "object"
  ) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  // Everything below parses attacker-controlled JSON shapes and touches
  // Firestore — never let a shape surprise or a downstream failure turn
  // into an uncaught throw. Resend would just keep retrying our bug.
  try {
    const data = event.data;
    const fromEmail = extractEmail(data.from);
    const fromRaw = rawFromString(data.from);
    const toAddresses = extractAddresses(data.to);
    const subject = typeof data.subject === "string" ? data.subject : "";
    const text = typeof data.text === "string" ? data.text : "";
    const html = typeof data.html === "string" ? data.html : null;
    const resendEmailId =
      typeof data.email_id === "string" && data.email_id ? data.email_id : null;
    const messageId =
      typeof data.message_id === "string" && data.message_id
        ? data.message_id
        : null;

    const db = getAdminDb();
    const matched = await matchContact(db, toAddresses, fromEmail);

    const inboundData: Omit<InboundEmailDoc, "id"> = {
      agencyId: matched?.agencyId ?? null,
      subAccountId: matched?.subAccountId ?? null,
      contactId: matched?.contactId ?? null,
      matchedBy: matched?.matchedBy ?? null,
      fromEmail,
      fromRaw,
      to: toAddresses,
      subject,
      text,
      html,
      resendEmailId,
      messageId,
      handled: false,
      receivedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    };
    const ref = resendEmailId
      ? db.doc(`inbound_emails/${resendEmailId}`)
      : db.collection("inbound_emails").doc();
    await ref.set({ id: ref.id, ...inboundData });

    if (matched) {
      const contactId = matched.contactId;

      await db
        .collection(`contacts/${contactId}/activities`)
        .add({
          type: "email_reply",
          content: `Reply received: ${subject}`,
          createdBy: "webhook:resend",
          meta: { inboundEmailId: ref.id, resendEmailId },
          createdAt: FieldValue.serverTimestamp(),
        })
        .catch((err) => {
          console.warn(
            "[resend-inbound] email_reply activity write failed",
            err
          );
        });

      // Stop-on-reply: a reply means the outbound sequence did its job.
      // Only outbound_sequence executions stop — lead_nurture and other
      // recipe types keep running (a reply mid-nurture isn't "done").
      const running = await db
        .collection("automation_executions")
        .where("contactId", "==", contactId)
        .where("status", "==", "running")
        .limit(50)
        .get();
      for (const ex of running.docs) {
        const autoSnap = await db
          .doc(`automations/${ex.data().automationId as string}`)
          .get();
        const auto = autoSnap.data();
        if (auto?.recipeType !== "outbound_sequence") continue;
        await ex.ref.update({
          status: "stopped",
          stoppedReason: "replied",
          completedAt: FieldValue.serverTimestamp(),
        });
        await db
          .collection(`contacts/${contactId}/activities`)
          .add({
            type: "automation_completed",
            content: `Sequence "${auto?.name ?? "sequence"}" stopped — contact replied.`,
            createdBy: "webhook:resend",
            meta: {
              automationId: ex.data().automationId,
              executionId: ex.id,
              stoppedReason: "replied",
            },
            createdAt: FieldValue.serverTimestamp(),
          })
          .catch(() => {});
      }

      // Human-inbox forward — best-effort, never fails ingestion.
      if (emailIsConfigured() && matched.subAccountId) {
        try {
          const subSnap = await db
            .doc(`subAccounts/${matched.subAccountId}`)
            .get();
          const replyToEmail = subSnap.data()?.replyToEmail as
            | string
            | null
            | undefined;
          if (replyToEmail) {
            await sendEmail({
              to: replyToEmail,
              subject: `[Reply] ${subject}`,
              text,
            });
          }
        } catch (err) {
          console.error("[resend-inbound] human-inbox forward failed", err);
        }
      }
    }

    return NextResponse.json({ ok: true, matched: !!matched });
  } catch (err) {
    console.error("[resend-inbound] ingestion failed", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
