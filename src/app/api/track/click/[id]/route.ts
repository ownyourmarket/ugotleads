import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { verifyTrackingToken } from "@/lib/comms/tracking";

export const dynamic = "force-dynamic";

/**
 * Click-tracking redirect endpoint. Rewrites email links to pass through
 * here so we can record a "link_clicked" activity, then 302-redirect to
 * the original URL.
 *
 * Query params:
 *   ?url=<encoded original URL>
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: token } = await params;
  const { searchParams } = new URL(request.url);
  const originalUrl = searchParams.get("url");

  // Always redirect — even if the token is invalid, don't strand the user
  const destination = originalUrl || "/";

  const payload = verifyTrackingToken(token);
  if (payload && originalUrl) {
    recordClick(payload.cid, payload.ctx, payload.ref, originalUrl).catch(
      () => {},
    );
  }

  return NextResponse.redirect(destination, { status: 302 });
}

async function recordClick(
  contactId: string,
  ctx: string,
  ref: string,
  url: string,
): Promise<void> {
  const db = getAdminDb();
  const contactRef = db.collection("contacts").doc(contactId);

  // Record every click (unlike opens, clicks on different links are
  // distinct events worth tracking). We still dedupe same-URL clicks
  // within the same context to avoid spam from double-clicks.
  const existing = await contactRef
    .collection("activities")
    .where("type", "==", "link_clicked")
    .where("meta.trackingRef", "==", ref)
    .where("meta.url", "==", url)
    .limit(1)
    .get();

  if (!existing.empty) return;

  await contactRef.collection("activities").add({
    type: "link_clicked",
    content: `Clicked link in ${ctx === "broadcast" ? "bulk email" : "email"}`,
    createdBy: "system",
    meta: {
      trackingCtx: ctx,
      trackingRef: ref,
      url,
    },
    createdAt: FieldValue.serverTimestamp(),
  });

  // Update broadcast send row
  if (ctx === "broadcast" && ref) {
    const broadcastSendRef = db
      .collection("broadcasts")
      .doc(ref)
      .collection("sends")
      .doc(contactId);
    await broadcastSendRef
      .update({ clickedAt: FieldValue.serverTimestamp() })
      .catch(() => {});
  }
}
