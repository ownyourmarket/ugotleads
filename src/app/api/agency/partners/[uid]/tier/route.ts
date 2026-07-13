import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { applyTierBundle } from "@/lib/fulfillment/tier-bundle";
import type { PartnerTier } from "@/types/partner";

const VALID_TIERS: PartnerTier[] = [
  "community",
  "operator",
  "certified",
  "elite",
];

interface CallerClaims {
  status?: string;
  agencyRole?: string;
  agencyId?: string | null;
}

/**
 * Set a partner's tier AND auto-grant every active product bundled into that
 * tier (Product.includedInTiers) as "tier_bundle" entitlements.
 *
 * This is the ONE write path for tier changes — the agency Partners UI calls
 * this instead of writing partner_profiles.tier from the client, so the
 * bundle grant (server-only: product_entitlements rejects client writes)
 * can never be skipped.
 *
 * Body: { tier: PartnerTier, applyBundleOnly?: boolean }
 * - applyBundleOnly: true → don't change the stored tier, just (re-)grant the
 *   bundle for the tier given. Used right after client-side partner creation
 *   and as a manual "re-sync bundle" action.
 *
 * Bundling is additive: downgrades never auto-revoke previously granted
 * entitlements — revocation stays a deliberate action in the entitlement
 * manager.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ uid: string }> },
) {
  const { uid: partnerUid } = await ctx.params;

  const callerUid = request.headers.get("x-user-uid");
  if (!callerUid) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const record = await getAdminAuth()
    .getUser(callerUid)
    .catch(() => null);
  if (!record) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const claims = (record.customClaims ?? {}) as CallerClaims;
  if (claims.status !== "active") {
    return NextResponse.json({ error: "Account inactive" }, { status: 403 });
  }
  if (claims.agencyRole !== "owner" || !claims.agencyId) {
    return NextResponse.json(
      { error: "Only the agency owner can change partner tiers." },
      { status: 403 },
    );
  }

  let body: { tier?: string; applyBundleOnly?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tier = body.tier as PartnerTier | undefined;
  if (!tier || !VALID_TIERS.includes(tier)) {
    return NextResponse.json(
      { error: `tier must be one of: ${VALID_TIERS.join(", ")}` },
      { status: 400 },
    );
  }

  const db = getAdminDb();
  const profileRef = db.doc(`partner_profiles/${partnerUid}`);
  const profileSnap = await profileRef.get();
  if (!profileSnap.exists) {
    return NextResponse.json(
      { error: "Partner profile not found." },
      { status: 404 },
    );
  }
  const profile = profileSnap.data() as {
    agencyId?: string;
    subAccountId?: string | null;
  };
  if (profile.agencyId !== claims.agencyId) {
    return NextResponse.json(
      { error: "Partner belongs to a different agency." },
      { status: 403 },
    );
  }

  if (!body.applyBundleOnly) {
    await profileRef.update({
      tier,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const bundle = await applyTierBundle({
    agencyId: claims.agencyId,
    partnerUid,
    tier,
    subAccountId: profile.subAccountId ?? null,
  });

  return NextResponse.json({ ok: true, tier, bundle });
}
