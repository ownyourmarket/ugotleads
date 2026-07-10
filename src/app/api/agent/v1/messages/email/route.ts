import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import { enforceDailyCap } from "@/lib/agent-api/caps";
import { withIdempotency } from "@/lib/agent-api/idempotency";
import {
  requireServiceAuth,
  subAccountAllowed,
} from "@/lib/auth/require-service-auth";
import { emailIsConfigured, sendEmail } from "@/lib/comms/resend";
import { recordSend } from "@/lib/comms/usage";

const DAILY_SEND_CAP = 100;
const MAX_SUBJECT_LEN = 300;
const MAX_BODY_LEN = 100_000;

export const POST = withAgentRoute(async (request: Request) => {
  if (!emailIsConfigured()) {
    return agentError("SEND_FAILED", "Email is not configured on this deployment.", 503);
  }

  const body = (await request.json().catch(() => null)) as {
    contactId?: string;
    subject?: string;
    body?: string;
  } | null;
  const contactId = typeof body?.contactId === "string" ? body.contactId.trim() : undefined;
  const subject = typeof body?.subject === "string" ? body.subject.trim() : undefined;
  const text = typeof body?.body === "string" ? body.body.trim() : undefined;
  if (!contactId || !subject || !text) {
    return agentError("VALIDATION_FAILED", "contactId, subject, and body are required.", 400);
  }
  if (subject.length > MAX_SUBJECT_LEN) {
    return agentError("VALIDATION_FAILED", `subject must be ${MAX_SUBJECT_LEN} characters or fewer.`, 400);
  }
  if (text.length > MAX_BODY_LEN) {
    return agentError("VALIDATION_FAILED", `body must be ${MAX_BODY_LEN} characters or fewer.`, 400);
  }

  const access = await requireServiceAuth(request, { scope: "sends:execute" });
  if (access instanceof NextResponse) return access;

  const db = getAdminDb();
  const contactSnap = await db.doc(`contacts/${contactId}`).get();
  if (!contactSnap.exists) return agentError("NOT_FOUND", "Contact not found.", 404);
  const contact = contactSnap.data() as Record<string, unknown>;
  if (!subAccountAllowed(access, contact.subAccountId as string)) {
    // Doc-ID-resolved foreign tenant: 404, not 403 — don't reveal existence.
    return agentError("NOT_FOUND", "Contact not found.", 404);
  }
  if (!contact.email) {
    return agentError("VALIDATION_FAILED", "This contact has no email address.", 400);
  }
  if (contact.emailOptedOut === true) {
    return agentError("CONTACT_OPTED_OUT", "Contact has opted out of email.", 409);
  }

  return withIdempotency(
    request,
    access.keyId,
    "messages:email",
    async () => {
      const subSnap = await db
        .doc(`subAccounts/${contact.subAccountId as string}`)
        .get();
      const replyTo =
        (subSnap.data()?.replyToEmail as string | null | undefined) ?? undefined;

      let messageId: string;
      try {
        const result = await sendEmail({
          to: contact.email as string,
          subject,
          text,
          replyTo,
        });
        messageId = result.id;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to send email";
        return { status: 502, body: { error: { code: "SEND_FAILED", message } } };
      }

      try {
        await db.collection(`contacts/${contactId}/activities`).add({
          type: "email_sent",
          content: `Email: ${subject}`,
          createdBy: `agent:${access.keyPrefix}`,
          meta: { messageId, subject },
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.warn("[agent email] activity write failed", err);
      }

      try {
        await recordSend(`agent:${access.keyPrefix}`, "email");
      } catch (err) {
        console.warn("[agent email] recordSend failed", err);
      }
      return { status: 200, body: { data: { id: messageId } } };
    },
    { preflight: () => enforceDailyCap(access.keyId, "sends", DAILY_SEND_CAP) },
  );
});
