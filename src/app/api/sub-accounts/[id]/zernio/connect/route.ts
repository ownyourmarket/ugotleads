import { NextResponse } from "next/server";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  getConnectUrl,
  type ZernioPlatform,
  zernioIsConfigured,
  ZernioError,
} from "@/lib/zernio/client";

/**
 * GET /api/sub-accounts/[id]/zernio/connect?platform=facebook
 *
 * Returns the Zernio-hosted OAuth Connect URL for a given platform on
 * this sub-account's Profile. The UI redirects the operator to this URL
 * to authorize. Zernio handles the platform-native consent screen,
 * stores the resulting token server-side, and webhooks us back with an
 * `account.connected` event so we can mirror it into our UI.
 *
 * Sub-account must already be provisioned (zernioProfileId set). The UI
 * should call /provision first, then this.
 */

const VALID_PLATFORMS = new Set<ZernioPlatform>([
  "facebook",
  "instagram",
  "linkedin",
  "twitter",
  "tiktok",
  "youtube",
  "pinterest",
  "threads",
  "reddit",
  "bluesky",
  "gmb",
  "telegram",
  "snapchat",
  "whatsapp",
  "discord",
]);

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  if (!zernioIsConfigured()) {
    return NextResponse.json(
      { error: "zernio_unconfigured" },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const platform = url.searchParams.get("platform") as ZernioPlatform | null;
  if (!platform || !VALID_PLATFORMS.has(platform)) {
    return NextResponse.json(
      {
        error: "invalid_platform",
        validValues: Array.from(VALID_PLATFORMS),
      },
      { status: 400 },
    );
  }

  const db = getAdminDb();
  const snap = await db.doc(`subAccounts/${id}`).get();
  const data = snap.data();
  if (!data) {
    return NextResponse.json({ error: "sub_account_not_found" }, { status: 404 });
  }
  const profileId = data.zernioProfileId as string | undefined;
  if (!profileId) {
    return NextResponse.json(
      {
        error: "not_provisioned",
        message:
          "Sub-account has no Zernio Profile yet. POST /zernio/provision first.",
      },
      { status: 409 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  const redirectUri = `${appUrl}/sa/${id}/social?connected=${platform}`;

  try {
    const result = await getConnectUrl({ platform, profileId, redirectUri });
    return NextResponse.json({ url: result.url, platform });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const status = err instanceof ZernioError ? err.status : 502;
    console.error(`[zernio/connect] failed sa=${id} platform=${platform}:`, msg);
    return NextResponse.json(
      { error: "connect_url_failed", message: msg.slice(0, 300) },
      { status },
    );
  }
}
