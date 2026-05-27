import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  createPost,
  zernioIsConfigured,
  ZernioError,
  type ZernioPlatform,
} from "@/lib/zernio/client";

/**
 * POST /api/sub-accounts/[id]/zernio/post
 *
 * Publish (or schedule) a post across the sub-account's connected
 * social accounts. Operator-friendly: the body specifies which
 * platforms to publish to; we look up each account ID from
 * Firestore's socialConnections mirror, hand the payload to Zernio,
 * and write the result back to socialPosts for the UI to render.
 *
 * Request body:
 *   {
 *     content:       string,                   // shared caption
 *     platforms:     string[],                 // e.g. ["linkedin", "facebook"]
 *     mediaUrls?:    string[],                 // images for now (video later)
 *     scheduledFor?: ISO string,               // omit = publish immediately
 *     timezone?:     IANA string,              // for scheduledFor interpretation
 *     perPlatformContent?: Record<platform, string>  // optional per-platform overrides
 *   }
 *
 * Idempotency: not strictly idempotent — Zernio creates a new post on
 * each call. UI should disable the submit button while in flight.
 */

interface RequestBody {
  content?: string;
  platforms?: string[];
  mediaUrls?: string[];
  scheduledFor?: string;
  timezone?: string;
  perPlatformContent?: Record<string, string>;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  if (!zernioIsConfigured()) {
    return NextResponse.json({ error: "zernio_unconfigured" }, { status: 503 });
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const content = body.content?.trim();
  if (!content || content.length === 0) {
    return NextResponse.json(
      { error: "content_required", message: "Post content can't be empty." },
      { status: 400 },
    );
  }
  if (content.length > 8000) {
    return NextResponse.json(
      { error: "content_too_long", message: "Keep posts under 8,000 characters." },
      { status: 400 },
    );
  }
  const platforms = Array.isArray(body.platforms) ? body.platforms : [];
  if (platforms.length === 0) {
    return NextResponse.json(
      { error: "platforms_required", message: "Pick at least one platform to publish to." },
      { status: 400 },
    );
  }

  const db = getAdminDb();
  const subSnap = await db.doc(`subAccounts/${id}`).get();
  const subData = subSnap.data();
  if (!subData) {
    return NextResponse.json({ error: "sub_account_not_found" }, { status: 404 });
  }
  const profileId = subData.zernioProfileId as string | undefined;
  if (!profileId) {
    return NextResponse.json(
      { error: "not_provisioned", message: "Connect a social account first." },
      { status: 409 },
    );
  }

  // Resolve each requested platform to its active connection account id.
  const connectionsSnap = await db
    .collection(`subAccounts/${id}/socialConnections`)
    .where("status", "==", "active")
    .get();
  const byPlatform = new Map<
    string,
    { accountId: string; displayName: string | null }
  >();
  for (const doc of connectionsSnap.docs) {
    const d = doc.data();
    const p = d.platform as string;
    // First active connection wins per-platform. Multi-account-per-platform
    // (e.g. two LinkedIn pages) is a Phase 2 enhancement.
    if (!byPlatform.has(p)) {
      byPlatform.set(p, {
        accountId: d.accountId as string,
        displayName: (d.displayName as string | null) ?? null,
      });
    }
  }

  const platformPayload: Array<{
    platform: ZernioPlatform;
    accountId: string;
    customContent?: string;
  }> = [];
  const missing: string[] = [];
  for (const p of platforms) {
    const conn = byPlatform.get(p);
    if (!conn) {
      missing.push(p);
      continue;
    }
    const entry: {
      platform: ZernioPlatform;
      accountId: string;
      customContent?: string;
    } = {
      platform: p as ZernioPlatform,
      accountId: conn.accountId,
    };
    const override = body.perPlatformContent?.[p];
    if (override && override.trim().length > 0) entry.customContent = override.trim();
    platformPayload.push(entry);
  }

  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "platforms_not_connected",
        missing,
        message: `Not connected on: ${missing.join(", ")}. Connect each platform first.`,
      },
      { status: 409 },
    );
  }

  // Build Zernio payload. Media accepted as image URLs in v1; videos
  // require a different `mediaItems[].type` and platform-specific
  // pre-upload — deferred.
  const mediaItems = (body.mediaUrls ?? [])
    .filter((u) => typeof u === "string" && u.startsWith("http"))
    .slice(0, 10)
    .map((url) => ({ type: "image" as const, url }));

  let zernioPost;
  try {
    zernioPost = await createPost({
      content,
      platforms: platformPayload,
      mediaItems: mediaItems.length > 0 ? mediaItems : undefined,
      scheduledFor: body.scheduledFor,
      timezone: body.timezone,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const status = err instanceof ZernioError ? err.status : 502;
    console.error(`[zernio/post] create failed sa=${id}:`, msg);
    return NextResponse.json(
      { error: "publish_failed", message: msg.slice(0, 400) },
      { status },
    );
  }

  // Mirror immediately into Firestore so the UI sees the post even
  // before any post.* webhook lands. Status follows what Zernio
  // returned (likely "scheduled" or "publishing" right after submit).
  await db
    .doc(`subAccounts/${id}/socialPosts/${zernioPost._id}`)
    .set(
      {
        zernioPostId: zernioPost._id,
        profileId,
        agencyId: subData.agencyId,
        subAccountId: id,
        createdByUid: auth.uid,
        content,
        platforms: platformPayload.map((p) => p.platform),
        mediaUrls: mediaItems.map((m) => m.url),
        scheduledFor: body.scheduledFor ?? null,
        status: zernioPost.status ?? (body.scheduledFor ? "scheduled" : "publishing"),
        perAccount: zernioPost.perAccount ?? [],
        lastEvent: "created",
        lastEventAt: Timestamp.now(),
        createdAt: Timestamp.now(),
      },
      { merge: true },
    );

  return NextResponse.json({
    ok: true,
    postId: zernioPost._id,
    status: zernioPost.status,
  });
}
