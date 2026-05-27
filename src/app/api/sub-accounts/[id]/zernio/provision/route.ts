import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  createProfile,
  zernioIsConfigured,
  ZernioError,
} from "@/lib/zernio/client";

/**
 * POST /api/sub-accounts/[id]/zernio/provision
 *
 * Idempotently ensures this sub-account has a paired Zernio Profile.
 * If `subAccount.zernioProfileId` is already set, returns it. Otherwise
 * creates a new Zernio Profile named after the sub-account and stores
 * the id back on the sub-account doc.
 *
 * Safe to call from the social connect UI on every page load — only the
 * first call hits Zernio's API; subsequent calls are no-ops.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  if (!zernioIsConfigured()) {
    return NextResponse.json(
      {
        error: "zernio_unconfigured",
        message: "ZERNIO_API_KEY is not set on this deployment.",
      },
      { status: 503 },
    );
  }

  const db = getAdminDb();
  const ref = db.doc(`subAccounts/${id}`);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "sub_account_not_found" }, { status: 404 });
  }
  const data = snap.data() ?? {};

  if (data.zernioProfileId) {
    return NextResponse.json({
      profileId: data.zernioProfileId,
      created: false,
    });
  }

  // Create a new Zernio Profile. Name = sub-account name for operator
  // friendliness when they view it in the Zernio dashboard themselves.
  // Description carries the UGotLeads sub-account ID so support can
  // reverse-look-up if needed.
  let profile;
  try {
    profile = await createProfile({
      name: (data.name as string) || `Sub-account ${id.slice(0, 8)}`,
      description: `UGotLeads sub-account ${id}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const status = err instanceof ZernioError ? err.status : 502;
    console.error(`[zernio/provision] create failed sa=${id}:`, msg);
    return NextResponse.json(
      { error: "zernio_create_failed", message: msg.slice(0, 300) },
      { status },
    );
  }

  await ref.update({
    zernioProfileId: profile._id,
    updatedAt: Timestamp.now(),
  });

  return NextResponse.json({
    profileId: profile._id,
    created: true,
    profile,
  });
}
