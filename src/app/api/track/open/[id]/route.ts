import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  TRACKING_PIXEL_GIF,
  verifyTrackingToken,
} from "@/lib/comms/tracking";

export const dynamic = "force-dynamic";

/**
 * Open-tracking pixel endpoint. When an email client loads this image,
 * we record an "email_opened" activity on the contact's timeline.
 *
 * Always returns the 1x1 GIF regardless of token validity — we never
 * want to break the email rendering for the recipient.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: token } = await params;

  // Fire-and-forget: record the open event
  const payload = verifyTrackingToken(token);
  if (payload) {
    recordOpen(payload.cid, payload.ctx, payload.ref).catch(() => {});
  }

  return new NextResponse(TRACKING_PIXEL_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(TRACKING_PIXEL_GIF.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}

async function recordOpen(
  contactId: string,
  ctx: string,
  ref: string,
): Promise<void> {
  const db = getAdminDb();
  const contactRef = db.collection("contacts").doc(contactId);

  // Check if we already recorded an open for this exact context — avoid
  // duplicate activities from email clients pre-fetching or multiple opens.
  const existing = await contactRef
    .collection("activities")
    .where("type", "==", "email_opened")
    .where("meta.trackingRef", "==", ref)
    .limit(1)
    .get();

  if (!existing.empty) return; // Already recorded

  await contactRef.collection("activities").add({
    type: "email_opened",
    content: ctx === "broadcast" ? "Opened bulk email" : "Opened email",
    createdBy: "system",
    meta: {
      trackingCtx: ctx,
      trackingRef: ref,
    },
    createdAt: FieldValue.serverTimestamp(),
  });

  // Also update the broadcast send row if this is a broadcast
  if (ctx === "broadcast" && ref) {
    const broadcastSendRef = db
      .collection("broadcasts")
      .doc(ref)
      .collection("sends")
      .doc(contactId);
    await broadcastSendRef
      .update({ openedAt: FieldValue.serverTimestamp() })
      .catch(() => {}); // Tolerate missing doc
  }
}
