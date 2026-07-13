/**
 * src/lib/fulfillment/tier-bundle.ts
 *
 * Tier auto-bundling: when a partner is set to (or created at) a tier, every
 * active product whose `includedInTiers` contains that tier is granted to
 * them as a product_entitlements row with source "tier_bundle".
 *
 * ── Design notes ──────────────────────────────────────────────────────────────
 * - Additive only. Moving a partner DOWN a tier does NOT revoke entitlements
 *   granted by a higher tier — revocation stays a deliberate agency-owner
 *   action in the entitlement manager, never an automatic side effect.
 * - Idempotent. grantProductEntitlement is keyed on (customerUserId, productId),
 *   so re-applying a tier (or re-running after a partial failure) is safe.
 * - The product query filters in code (agencyId fetch, then status +
 *   includedInTiers in memory) — product catalogs are small and this avoids
 *   needing a composite Firestore index for array-contains + equality.
 */

import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import {
  grantProductEntitlement,
} from "@/lib/fulfillment/grant-entitlement";
import type { PartnerTier } from "@/types/partner";
import type { AccessModel, BundleTier, ProductFamily } from "@/types/products";

export interface ApplyTierBundleInput {
  agencyId: string;
  /** The partner receiving the bundle (partner_profiles doc id === uid). */
  partnerUid: string;
  /** The tier being applied. */
  tier: PartnerTier;
  /** The partner's workspace, stamped onto each entitlement. Null is fine. */
  subAccountId: string | null;
}

export interface ApplyTierBundleResult {
  /** Product names newly granted by this call. */
  granted: string[];
  /** Product names that were already active (no-op). */
  alreadyActive: string[];
  /** Product names whose grant failed (logged; never throws). */
  failed: string[];
}

interface ProductRow {
  id: string;
  name?: string;
  status?: string;
  includedInTiers?: BundleTier[] | null;
  productFamily?: ProductFamily | null;
  accessModel?: AccessModel;
}

/**
 * Grants every active, tier-bundled product to the partner. Best-effort per
 * product — one failed grant never blocks the rest, and the function never
 * throws (callers treat bundling as a side effect of the tier change).
 */
export async function applyTierBundle(
  input: ApplyTierBundleInput,
): Promise<ApplyTierBundleResult> {
  const result: ApplyTierBundleResult = {
    granted: [],
    alreadyActive: [],
    failed: [],
  };

  let bundled: ProductRow[] = [];
  try {
    const snap = await getAdminDb()
      .collection("products")
      .where("agencyId", "==", input.agencyId)
      .get();
    bundled = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<ProductRow, "id">) }))
      .filter(
        (p) =>
          p.status === "active" &&
          Array.isArray(p.includedInTiers) &&
          p.includedInTiers.includes(input.tier),
      );
  } catch (err) {
    console.error("[tier-bundle] product query failed:", err);
    return result;
  }

  for (const product of bundled) {
    const grant = await grantProductEntitlement({
      agencyId: input.agencyId,
      customerUserId: input.partnerUid,
      productId: product.id,
      subAccountId: input.subAccountId,
      productName: product.name ?? product.id,
      productFamily: product.productFamily ?? null,
      accessModel: product.accessModel ?? "subscription",
      grantingSessionId: null,
      source: "tier_bundle",
    });

    const name = product.name ?? product.id;
    if ("error" in grant) {
      result.failed.push(name);
    } else if (grant.alreadyActive) {
      result.alreadyActive.push(name);
    } else {
      result.granted.push(name);
    }
  }

  if (result.granted.length || result.failed.length) {
    console.info(
      `[tier-bundle] tier=${input.tier} partner=${input.partnerUid} ` +
        `granted=${result.granted.length} already=${result.alreadyActive.length} failed=${result.failed.length}`,
    );
  }
  return result;
}
