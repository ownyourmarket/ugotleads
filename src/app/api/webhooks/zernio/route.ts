import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

/**
 * POST /api/webhooks/zernio
 *
 * Zernio webhook receiver. HMAC-SHA256 verified against
 * ZERNIO_WEBHOOK_SECRET. Mirrors every relevant event into Firestore so
 * the UGotLeads UI + audit log stay in sync with what Zernio is doing
 * on the platforms.
 *
 * Public-path (no session cookie); security is the X-Zernio-Signature
 * header.
 *
 * Event types we handle (full list: docs.zernio.com/webhooks):
 *   - account.connected / .disconnected  → mirror into socialConnections
 *   - post.published / .failed / .partial / .scheduled / .cancelled
 *   - lead.received        → create a Contact in the sub-account CRM
 *   - review.new / .updated → create activity row + future reputation flow
 *   - comment.received / reaction.received  → activity row
 *   - message.received / .sent / .delivered / .read / .failed → DM thread
 *
 * Unhandled event types are logged and 200'd so Zernio doesn't retry.
 */

const HEADER_SIG = "x-zernio-signature";
const HEADER_EVENT_ID = "x-zernio-event-id";

interface ZernioEvent {
  id: string;
  event: string;
  timestamp: string;
  // Event-specific objects on the payload. We grab what we need
  // per-handler and let unknowns pass through.
  [key: string]: unknown;
}

interface AccountObject {
  _id?: string;
  profileId?: string;
  platform?: string;
  username?: string;
  displayName?: string;
  [key: string]: unknown;
}

interface PostObject {
  _id?: string;
  profileId?: string;
  status?: string;
  publishedAt?: string;
  perAccount?: Array<{
    accountId?: string;
    platform?: string;
    status?: string;
    platformPostId?: string;
    error?: string;
  }>;
  [key: string]: unknown;
}

export async function POST(request: Request) {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[zernio/webhook] ZERNIO_WEBHOOK_SECRET not set — rejecting");
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const signature = request.headers.get(HEADER_SIG);
  const eventId = request.headers.get(HEADER_EVENT_ID);
  const raw = await request.text();

  if (!signature || !verifySignature(raw, signature, secret)) {
    console.warn(`[zernio/webhook] invalid signature, eventId=${eventId}`);
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let event: ZernioEvent;
  try {
    event = JSON.parse(raw) as ZernioEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const db = getAdminDb();

  // Idempotency: drop duplicate deliveries by event id.
  if (event.id) {
    const dedupRef = db.doc(`zernioEvents/${event.id}`);
    try {
      await dedupRef.create({
        eventId: event.id,
        event: event.event,
        receivedAt: Timestamp.now(),
      });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 6) {
        // Already processed — Zernio retried. 200 to stop the retry loop.
        return NextResponse.json({ ok: true, deduped: true });
      }
      console.error("[zernio/webhook] dedup write failed", err);
    }
  }

  try {
    await handleEvent(event, db);
  } catch (err) {
    console.error(
      `[zernio/webhook] handler failed event=${event.event} id=${event.id}:`,
      err,
    );
    // Returning 500 makes Zernio retry. For most handler failures we
    // prefer to 200 + log, since retries rarely fix a malformed payload.
    // Surface the failure on the dedup doc for debugging.
    if (event.id) {
      await db.doc(`zernioEvents/${event.id}`).set(
        {
          handlerError:
            err instanceof Error ? err.message.slice(0, 500) : String(err),
        },
        { merge: true },
      );
    }
  }

  return NextResponse.json({ ok: true });
}

function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function handleEvent(
  event: ZernioEvent,
  db: FirebaseFirestore.Firestore,
): Promise<void> {
  const kind = event.event;
  if (typeof kind !== "string") return;

  // ── Account lifecycle ────────────────────────────────────────────────
  if (kind === "account.connected" || kind === "account.disconnected") {
    const account = event.account as AccountObject | undefined;
    if (!account?.profileId) return;
    const subAccountId = await findSubAccountByProfile(db, account.profileId);
    if (!subAccountId) return;

    const accountId = account._id ?? "";
    if (!accountId) return;
    const connRef = db.doc(
      `subAccounts/${subAccountId}/socialConnections/${accountId}`,
    );
    if (kind === "account.connected") {
      await connRef.set(
        {
          accountId,
          profileId: account.profileId,
          platform: account.platform ?? "unknown",
          username: account.username ?? null,
          displayName: account.displayName ?? null,
          status: "active",
          connectedAt: Timestamp.now(),
        },
        { merge: true },
      );
    } else {
      await connRef.set(
        { status: "disconnected", disconnectedAt: Timestamp.now() },
        { merge: true },
      );
    }
    return;
  }

  // ── Post lifecycle ───────────────────────────────────────────────────
  if (kind.startsWith("post.")) {
    const post = event.post as PostObject | undefined;
    if (!post?.profileId || !post._id) return;
    const subAccountId = await findSubAccountByProfile(db, post.profileId);
    if (!subAccountId) return;

    await db
      .doc(`subAccounts/${subAccountId}/socialPosts/${post._id}`)
      .set(
        {
          zernioPostId: post._id,
          profileId: post.profileId,
          status: post.status ?? kind.replace("post.", ""),
          publishedAt: post.publishedAt ?? null,
          perAccount: post.perAccount ?? [],
          lastEvent: kind,
          lastEventAt: Timestamp.now(),
        },
        { merge: true },
      );
    return;
  }

  // ── Lead-form submissions → create a Contact ─────────────────────────
  if (kind === "lead.received") {
    const lead = event.lead as Record<string, unknown> | undefined;
    const profileId = lead?.profileId as string | undefined;
    if (!profileId) return;
    const subAccountId = await findSubAccountByProfile(db, profileId);
    if (!subAccountId) return;
    const subSnap = await db.doc(`subAccounts/${subAccountId}`).get();
    const agencyId = subSnap.data()?.agencyId as string | undefined;
    if (!agencyId) return;

    const fields = (lead?.fields ?? {}) as Record<string, string>;
    await db.collection("contacts").add({
      agencyId,
      subAccountId,
      createdByUid: null,
      source: "zernio-lead",
      name: fields.full_name ?? fields.name ?? "",
      email: fields.email ?? "",
      phone: fields.phone_number ?? fields.phone ?? "",
      company: fields.company_name ?? "",
      notes: `Lead from ${lead?.platform ?? "social"} via Zernio webhook`,
      attribution: {
        utmSource: typeof lead?.platform === "string" ? lead.platform : null,
        utmMedium: "social-lead-form",
        utmCampaign: typeof lead?.adId === "string" ? lead.adId : null,
        utmContent: null,
        utmTerm: null,
        fbclid: null,
        gclid: null,
        landingPage: null,
        referrer: null,
      },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    return;
  }

  // ── Reviews / engagement — write activity rows ───────────────────────
  if (
    kind === "review.new" ||
    kind === "review.updated" ||
    kind === "comment.received" ||
    kind === "reaction.received" ||
    kind.startsWith("message.")
  ) {
    // Phase 1: log into a sub-collection for now; per-channel surfacing
    // (review dashboard, comment auto-reply, DM thread) ships in
    // follow-up commits.
    const profileId =
      (event.review as Record<string, unknown> | undefined)?.profileId ??
      (event.comment as Record<string, unknown> | undefined)?.profileId ??
      (event.reaction as Record<string, unknown> | undefined)?.profileId ??
      (event.message as Record<string, unknown> | undefined)?.profileId;
    if (typeof profileId !== "string") return;
    const subAccountId = await findSubAccountByProfile(db, profileId);
    if (!subAccountId) return;

    await db.collection(`subAccounts/${subAccountId}/socialEvents`).add({
      kind,
      eventId: event.id,
      receivedAt: Timestamp.now(),
      payload: event,
    });
    return;
  }

  // ── Webhook test ────────────────────────────────────────────────────
  if (kind === "webhook.test") {
    console.info("[zernio/webhook] received webhook.test ping");
    return;
  }

  console.info(`[zernio/webhook] unhandled event type: ${kind}`);
}

async function findSubAccountByProfile(
  db: FirebaseFirestore.Firestore,
  profileId: string,
): Promise<string | null> {
  const q = await db
    .collection("subAccounts")
    .where("zernioProfileId", "==", profileId)
    .limit(1)
    .get();
  if (q.empty) return null;
  return q.docs[0].id;
}
