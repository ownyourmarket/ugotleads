import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import { getAdminDb } from "@/lib/firebase/admin";

/**
 * POST /api/sub-accounts/[id]/reviews/request
 *
 * Send a review request to a contact via email and/or SMS. The request
 * includes a direct link to the business's Google review page (or any
 * custom review URL the operator configures).
 *
 * Request body:
 *   {
 *     contactId: string,
 *     channel: "email" | "sms" | "both",
 *     reviewUrl: string,         // Google review URL or custom
 *     customMessage?: string,    // optional personal note
 *   }
 */

interface RequestBody {
  contactId?: string;
  channel?: "email" | "sms" | "both";
  reviewUrl?: string;
  customMessage?: string;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { contactId, channel, reviewUrl, customMessage } = body;

  if (!contactId) {
    return NextResponse.json(
      { error: "contact_required", message: "Pick a contact to send the review request to." },
      { status: 400 },
    );
  }
  if (!channel || !["email", "sms", "both"].includes(channel)) {
    return NextResponse.json(
      { error: "channel_required", message: "Pick email, sms, or both." },
      { status: 400 },
    );
  }
  if (!reviewUrl || !reviewUrl.startsWith("http")) {
    return NextResponse.json(
      { error: "review_url_required", message: "Provide a valid review URL (Google, Yelp, etc.)." },
      { status: 400 },
    );
  }

  const db = getAdminDb();
  const contactSnap = await db.doc(`contacts/${contactId}`).get();
  const contact = contactSnap.data();
  if (!contact || contact.subAccountId !== id) {
    return NextResponse.json(
      { error: "contact_not_found", message: "Contact not found in this sub-account." },
      { status: 404 },
    );
  }

  const contactName = (contact.firstName as string) ?? (contact.name as string) ?? "there";
  const results: { email?: string; sms?: string } = {};

  // Build the review message
  const personalNote = customMessage?.trim()
    ? `${customMessage.trim()}\n\n`
    : "";
  const emailBody = `Hi ${contactName},\n\n${personalNote}We'd really appreciate it if you could take a moment to share your experience with us. Your feedback helps other customers find us and helps us improve.\n\nLeave a review here: ${reviewUrl}\n\nThank you!`;
  const smsBody = `Hi ${contactName}! ${personalNote ? personalNote.trim() + " " : ""}We'd love your feedback — please leave us a quick review: ${reviewUrl} Thank you!`;

  // Send email
  if ((channel === "email" || channel === "both") && contact.email) {
    try {
      const emailRes = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL}/api/comms/email/send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-uid": auth.uid,
            "x-user-email": auth.email ?? "",
          },
          body: JSON.stringify({
            contactId,
            subAccountId: id,
            subject: "We'd love your feedback!",
            body: emailBody,
          }),
        },
      );
      results.email = emailRes.ok ? "sent" : "failed";
    } catch {
      results.email = "failed";
    }
  } else if (channel === "email" || channel === "both") {
    results.email = "skipped_no_email";
  }

  // Send SMS
  if ((channel === "sms" || channel === "both") && contact.phone) {
    try {
      const smsRes = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL}/api/comms/sms/send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-uid": auth.uid,
            "x-user-email": auth.email ?? "",
          },
          body: JSON.stringify({
            contactId,
            subAccountId: id,
            body: smsBody,
          }),
        },
      );
      results.sms = smsRes.ok ? "sent" : "failed";
    } catch {
      results.sms = "failed";
    }
  } else if (channel === "sms" || channel === "both") {
    results.sms = "skipped_no_phone";
  }

  // Record the request
  await db.collection(`subAccounts/${id}/reviewRequests`).add({
    contactId,
    contactName,
    channel,
    reviewUrl,
    customMessage: customMessage?.trim() ?? null,
    results,
    sentByUid: auth.uid,
    createdAt: Timestamp.now(),
  });

  return NextResponse.json({ ok: true, results });
}
