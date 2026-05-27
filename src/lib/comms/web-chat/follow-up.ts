import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveAgent } from "@/lib/comms/ai/agent";
import { emailIsConfigured, sendEmail } from "@/lib/comms/resend";

/**
 * Post-capture obligations: every Web Chat capture creates a Task and
 * notifies the escalation email. The bot's reply already promises "the
 * team will reach out" — these mechanisms turn that promise into a
 * tracked action item.
 *
 * Both steps are best-effort: if the task write fails or the email
 * bounces, the capture itself still succeeded (Contact is created,
 * session linked). Failures are logged + returned so the caller can
 * surface a warning, but never block the visitor's "thanks" reply.
 */

interface CreateFollowUpInput {
  agencyId: string;
  subAccountId: string;
  sessionId: string;
  contactId: string;
  capturedName: string | null;
  capturedEmail: string | null;
  capturedPhone: string | null;
  /** The visitor's most recent inbound — used in the email body so the
   *  operator has context. Capped client-side already. */
  lastInboundMessage: string | null;
  pageUrl: string | null;
}

export interface FollowUpResult {
  taskId: string | null;
  emailSent: boolean;
  errors: string[];
}

export async function createFollowUpActions(
  input: CreateFollowUpInput,
): Promise<FollowUpResult> {
  const errors: string[] = [];

  const identity =
    input.capturedName ||
    input.capturedEmail ||
    input.capturedPhone ||
    "Anonymous web visitor";

  // ----- 1. Create the Task -----
  let taskId: string | null = null;
  try {
    const db = getAdminDb();
    // Due "today" — set dueAt to end-of-today UTC so it lands in the
    // Today bucket regardless of operator timezone for v1. (Per-task
    // timezone awareness is a future refinement.)
    const now = new Date();
    const dueAt = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
    );

    const notes = [
      `Captured from Web Chat session: ${input.sessionId}`,
      input.pageUrl ? `Page: ${input.pageUrl}` : null,
      input.capturedEmail ? `Email: ${input.capturedEmail}` : null,
      input.capturedPhone ? `Phone: ${input.capturedPhone}` : null,
      input.lastInboundMessage
        ? `\nLast visitor message:\n"${input.lastInboundMessage}"`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    const taskRef = await db.collection("tasks").add({
      title: `Follow up with ${identity} from Web Chat`,
      notes,
      dueAt,
      completed: false,
      completedAt: null,
      contactId: input.contactId,
      dealId: null,
      eventId: null,
      agencyId: input.agencyId,
      subAccountId: input.subAccountId,
      createdByUid: "web-chat-bot",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    taskId = taskRef.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[web-chat/follow-up] task create failed sa=${input.subAccountId}`,
      err,
    );
    errors.push(`task: ${msg}`);
  }

  // ----- 2. Send the escalation email -----
  let emailSent = false;
  if (!emailIsConfigured()) {
    errors.push("email: not configured");
  } else {
    try {
      // Pull the escalation email from the agent (channel override wins,
      // else profile default). resolveAgent does the merge.
      const agent = await resolveAgent(input.subAccountId, "web-chat");
      const to = agent?.effective.escalationNotifyEmail?.trim();
      if (!to) {
        errors.push("email: no escalation address configured");
      } else {
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://ugotleads.io";
        const sessionUrl = `${appUrl}/sa/${input.subAccountId}/ai-agents/web-chat/sessions/${input.sessionId}`;
        const contactUrl = `${appUrl}/sa/${input.subAccountId}/contacts/${input.contactId}`;

        const subject = `New Web Chat lead: ${identity}`;
        const businessName =
          agent?.effective.businessName?.trim() || "your business";

        const html = renderCaptureEmail({
          businessName,
          identity,
          capturedName: input.capturedName,
          capturedEmail: input.capturedEmail,
          capturedPhone: input.capturedPhone,
          pageUrl: input.pageUrl,
          lastInboundMessage: input.lastInboundMessage,
          sessionUrl,
          contactUrl,
        });

        // Plain-text fallback for inbox previews + clients that block HTML.
        const text = [
          `New Web Chat lead — ${identity}`,
          "",
          input.capturedName ? `Name: ${input.capturedName}` : null,
          input.capturedEmail ? `Email: ${input.capturedEmail}` : null,
          input.capturedPhone ? `Phone: ${input.capturedPhone}` : null,
          input.pageUrl ? `Page: ${input.pageUrl}` : null,
          input.lastInboundMessage
            ? `\nLatest message:\n${input.lastInboundMessage}`
            : null,
          "",
          `Session: ${sessionUrl}`,
          `Contact: ${contactUrl}`,
          "",
          "A follow-up task has been created in your Tasks list, due today.",
        ]
          .filter((s): s is string => s !== null)
          .join("\n");

        await sendEmail({
          to,
          subject,
          text,
          html,
        });
        emailSent = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(
        `[web-chat/follow-up] email send failed sa=${input.subAccountId}`,
        err,
      );
      errors.push(`email: ${msg}`);
    }
  }

  return { taskId, emailSent, errors };
}

function renderCaptureEmail(input: {
  businessName: string;
  identity: string;
  capturedName: string | null;
  capturedEmail: string | null;
  capturedPhone: string | null;
  pageUrl: string | null;
  lastInboundMessage: string | null;
  sessionUrl: string;
  contactUrl: string;
}): string {
  const detailsTable = [
    input.capturedName ? ["Name", esc(input.capturedName)] : null,
    input.capturedEmail
      ? [
          "Email",
          `<a href="mailto:${esc(input.capturedEmail)}">${esc(input.capturedEmail)}</a>`,
        ]
      : null,
    input.capturedPhone
      ? [
          "Phone",
          `<a href="tel:${esc(input.capturedPhone)}">${esc(input.capturedPhone)}</a>`,
        ]
      : null,
    input.pageUrl ? ["Page", `<a href="${esc(input.pageUrl)}">${esc(input.pageUrl)}</a>`] : null,
  ]
    .filter((r): r is [string, string] => r !== null)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:13px;">${esc(k)}</td><td style="padding:4px 0;font-size:13px;">${v}</td></tr>`,
    )
    .join("");

  const lastMsgBlock = input.lastInboundMessage
    ? `<div style="margin-top:20px;padding:12px 14px;background:#f8fafc;border-left:3px solid #7c3aed;border-radius:4px;">
         <div style="font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.05em;margin-bottom:6px;">Latest message</div>
         <div style="font-size:14px;color:#0f172a;white-space:pre-wrap;">${esc(input.lastInboundMessage)}</div>
       </div>`
    : "";

  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;padding:28px;">
    <div style="font-size:11px;text-transform:uppercase;color:#7c3aed;letter-spacing:0.08em;font-weight:600;">New Web Chat lead</div>
    <h1 style="margin:8px 0 4px;font-size:20px;color:#0f172a;">${esc(input.identity)} just reached out</h1>
    <p style="margin:0 0 20px;color:#64748b;font-size:14px;">A visitor on ${esc(input.businessName)}'s site shared their contact details via the AI chat widget.</p>
    <table style="border-collapse:collapse;width:100%;">${detailsTable}</table>
    ${lastMsgBlock}
    <div style="margin-top:24px;display:flex;gap:8px;">
      <a href="${esc(input.sessionUrl)}" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;">Open chat session</a>
      <a href="${esc(input.contactUrl)}" style="display:inline-block;background:transparent;color:#7c3aed;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;border:1px solid #c4b5fd;">View contact</a>
    </div>
    <p style="margin:24px 0 0;color:#94a3b8;font-size:11px;">A follow-up task has been created in your Tasks list, due today.</p>
  </div>
</body></html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
