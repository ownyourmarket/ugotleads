/**
 * src/lib/fulfillment/grant-entitlement.ts
 *
 * Server-side (Admin SDK) product entitlement grant for fulfilled purchases.
 *
 * When a marketplace checkout completes and the payment is confirmed, the
 * customer should be recorded as ENTITLED to the product they bought. This
 * helper writes a product_entitlements/{customerUserId}_{productId} doc.
 *
 * ── Distinct from product_eligibility ─────────────────────────────────────────
 * product_eligibility (partnerProfileId-keyed) = partner SELL rights.
 * product_entitlements (customerUserId-keyed)  = customer ACCESS rights.
 * Separate collections, separate concerns. This helper only touches the latter.
 *
 * ── Idempotency ───────────────────────────────────────────────────────────────
 * Doc id is deterministic (`${customerUserId}_${productId}`). A duplicate webhook
 * delivery finds an existing active entitlement and returns { alreadyActive: true }
 * without rewriting. A revoked entitlement is re-activated on re-purchase.
 *
 * ── Not in scope ──────────────────────────────────────────────────────────────
 * - No email (deferred).
 * - No checkout / Stripe activation.
 * - No commission math.
 * - No MLM / genealogy / downline / rank / team-volume / compensation logic.
 */

import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import type { AccessModel, ProductFamily } from "@/types/products";

export interface GrantEntitlementInput {
  agencyId: string;
  customerUserId: string;
  productId: string;
  subAccountId: string | null;
  /** Denormalized product snapshot at grant time. */
  productName: string;
  productFamily: ProductFamily | null;
  accessModel: AccessModel;
  /** Stripe session id that triggered the grant. */
  grantingSessionId: string | null;
}

export type GrantEntitlementResult =
  | { ok: true; entitlementId: string; alreadyActive: boolean }
  | { error: true; message: string };

/**
 * Grants (or re-activates) a customer's entitlement to a product.
 * Idempotent on repeated calls with the same customer + product.
 */
export async function grantProductEntitlement(
  input: GrantEntitlementInput,
): Promise<GrantEntitlementResult> {
  if (!input.agencyId || !input.customerUserId || !input.productId) {
    return { error: true, message: "agencyId, customerUserId, and productId are required." };
  }

  const db = getAdminDb();
  const entitlementId = `${input.customerUserId}_${input.productId}`;
  const ref = db.doc(`product_entitlements/${entitlementId}`);

  try {
    const snap = await ref.get().catch(() => null);

    if (snap?.exists) {
      const data = snap.data() as { status?: string };
      if (data.status === "active") {
        // Already fulfilled — idempotent no-op.
        return { ok: true, entitlementId, alreadyActive: true };
      }
      // Was revoked — re-activate on re-purchase.
      await ref.update({
        status: "active",
        grantingSessionId: input.grantingSessionId,
        grantedAt: FieldValue.serverTimestamp(),
        revokedAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.info(`[fulfillment] Re-activated entitlement ${entitlementId}`);
      return { ok: true, entitlementId, alreadyActive: false };
    }

    // First grant.
    await ref.set({
      id: entitlementId,
      agencyId: input.agencyId,
      subAccountId: input.subAccountId ?? null,
      customerUserId: input.customerUserId,
      productId: input.productId,
      productName: input.productName,
      productFamily: input.productFamily ?? null,
      accessModel: input.accessModel,
      status: "active",
      source: "marketplace_purchase",
      grantingSessionId: input.grantingSessionId ?? null,
      grantedAt: FieldValue.serverTimestamp(),
      revokedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.info(`[fulfillment] Granted entitlement ${entitlementId} for product ${input.productId}`);
    return { ok: true, entitlementId, alreadyActive: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Firestore write failed.";
    console.error(`[fulfillment] Failed to grant entitlement ${entitlementId}:`, err);
    return { error: true, message };
  }
}
