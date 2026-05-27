import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  listAccounts,
  zernioIsConfigured,
  ZernioError,
  type ZernioAccount,
} from "@/lib/zernio/client";

/**
 * POST /api/sub-accounts/[id]/zernio/sync
 *
 * Pulls the truth from Zernio for this sub-account's profile and
 * mirrors it into `socialConnections`. Idempotent: documents whose
 * Zernio-side `isActive`/`enabled` flags say the account is gone get
 * marked `status: "disconnected"`; everything else gets updated in
 * place.
 *
 * This exists for two reasons:
 *
 *   1. Safety net for webhook deliveries we missed (rate-limits,
 *      transient infra blips, mis-configured endpoint during testing).
 *      Zernio's API is the source of truth; calling this resyncs us.
 *   2. UX cushion right after the OAuth dance — the operator lands
 *      back on /social and we can immediately reflect their just-
 *      connected accounts even if the webhook hasn't arrived yet
 *      (it might be seconds behind the redirect).
 *
 * Safe to call on every /social page load.
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
      { error: "zernio_unconfigured" },
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
  const profileId = data.zernioProfileId as string | undefined;
  if (!profileId) {
    return NextResponse.json(
      { ok: true, message: "Not provisioned yet — sync is a no-op.", accounts: [] },
    );
  }

  let accounts: ZernioAccount[];
  try {
    accounts = await listAccounts(profileId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const status = err instanceof ZernioError ? err.status : 502;
    console.error(`[zernio/sync] listAccounts failed sa=${id}:`, msg);
    return NextResponse.json(
      { error: "zernio_list_failed", message: msg.slice(0, 300) },
      { status },
    );
  }

  // Mirror each Zernio account into Firestore. Doc id = Zernio account
  // _id for natural idempotency on repeat syncs.
  const writes: Promise<unknown>[] = [];
  const seenIds = new Set<string>();
  for (const a of accounts) {
    seenIds.add(a._id);
    const connRef = db.doc(`subAccounts/${id}/socialConnections/${a._id}`);
    // Zernio nests profile id on accounts under `.profileId._id` when
    // populated (see live API response 2026-05-27). Normalize to a
    // plain string so our downstream reads stay simple.
    const profileIdField =
      typeof a.profileId === "string"
        ? a.profileId
        : (a.profileId as { _id?: string } | undefined)?._id ?? profileId;
    // Zernio's Account shape has extra fields we read defensively
    // (isActive, displayName, createdAt, etc.). Cast through `unknown`
    // so TS allows the indexed access without complaining that the
    // interface is too narrow.
    const raw = a as unknown as Record<string, unknown>;
    const isActive = (raw.isActive as boolean | undefined) ?? true;
    const enabled = (raw.enabled as boolean | undefined) ?? true;
    const status = isActive && enabled ? "active" : "disconnected";
    const connectedAtSource =
      (raw.connectedAt as string | undefined) ??
      (raw.createdAt as string | undefined);
    writes.push(
      connRef.set(
        {
          accountId: a._id,
          profileId: profileIdField,
          platform: a.platform ?? "unknown",
          username:
            (raw.username as string | undefined) ??
            (raw.displayName as string | undefined) ??
            null,
          displayName: (raw.displayName as string | undefined) ?? null,
          followersCount: (raw.followersCount as number | undefined) ?? null,
          status,
          connectedAt: connectedAtSource
            ? Timestamp.fromDate(new Date(connectedAtSource))
            : Timestamp.now(),
          syncedAt: Timestamp.now(),
        },
        { merge: true },
      ),
    );
  }

  // Mark stale docs (in Firestore but not in Zernio anymore) as disconnected.
  const existing = await db
    .collection(`subAccounts/${id}/socialConnections`)
    .get();
  for (const doc of existing.docs) {
    if (seenIds.has(doc.id)) continue;
    writes.push(
      doc.ref.set(
        { status: "disconnected", syncedAt: Timestamp.now() },
        { merge: true },
      ),
    );
  }

  await Promise.all(writes);

  return NextResponse.json({
    ok: true,
    profileId,
    accountsSynced: accounts.length,
    accounts: accounts.map((a) => ({
      _id: a._id,
      platform: a.platform,
      displayName: (a as { displayName?: string }).displayName ?? null,
    })),
  });
}
