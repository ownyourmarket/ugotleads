import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  createProfile,
  listProfiles,
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
      reused: false,
    });
  }

  // Truly idempotent provision. Three paths, in order:
  //   1. Sub-account doc has zernioProfileId → return it (handled above).
  //   2. Zernio already has a Profile with description matching this
  //      sub-account ID (from a prior provision call that crashed
  //      mid-write) → adopt it, write the id back to Firestore.
  //   3. No matching profile exists → create one with a unique
  //      description (carrying the sub-account ID) so future
  //      reconciliation works, then write back.
  //
  // The description-based match (not name-based) means two operators
  // can independently name their workspaces "Main" without colliding on
  // Zernio's per-name uniqueness constraint, since their descriptions
  // contain distinct sub-account IDs.
  const DESC_MARKER = `UGotLeads sub-account ${id}`;

  let existing;
  try {
    const all = await listProfiles();
    existing = all.find((p) => p.description === DESC_MARKER);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[zernio/provision] listProfiles failed sa=${id}:`, msg);
    return NextResponse.json(
      { error: "zernio_list_failed", message: msg.slice(0, 300) },
      { status: 502 },
    );
  }

  if (existing) {
    await ref.update({
      zernioProfileId: existing._id,
      updatedAt: Timestamp.now(),
    });
    return NextResponse.json({
      profileId: existing._id,
      created: false,
      reused: true,
      profile: existing,
    });
  }

  // Name has the sub-account ID prefix appended to dodge Zernio's
  // unique-name constraint across the whole agency's profile namespace.
  // The dashboard shows the description too, so operators still see
  // their sub-account name clearly.
  const baseName = (data.name as string)?.trim() || `Sub-account ${id.slice(0, 8)}`;
  const uniqueName = `${baseName} · ${id.slice(0, 6)}`;

  let profile;
  try {
    profile = await createProfile({
      name: uniqueName,
      description: DESC_MARKER,
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
    reused: false,
    profile,
  });
}
