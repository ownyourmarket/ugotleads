import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { commissionForAmount } from "@/lib/affiliate/codes";
import {
  findAffiliateByCode,
  findAffiliateByEmail,
} from "@/lib/affiliate/account";

interface CreateReferralInput {
  refCode: string;
  purchaseSessionId: string;
  buyerEmail: string;
  amountPaidCents: number | null;
}

type CreateReferralOutcome =
  | { status: "credited"; referralId: string; commissionCents: number }
  | { status: "skipped"; reason: string };

/**
 * Credits an affiliate for a founders purchase that arrived via their
 * ?ref=CODE link. Called from the Stripe webhook after the affiliate
 * account for the buyer is ensured, gated on LANDING_VARIANT === "leadstack".
 *
 * Idempotency: the doc id is the Stripe checkout session id, so a retried
 * webhook delivery for the same purchase can't double-credit. The .create()
 * call throws ALREADY_EXISTS (code 6) on dup, which we catch and treat as
 * a successful no-op.
 *
 * Self-referral check: if the ref code resolves to the same affiliate as
 * the buyer's auto-enrolled account (same email), we skip the credit with
 * `reason: "self_referral"`. The webhook still creates the buyer's own
 * affiliate account; we just don't pay them for referring themselves.
 */
export async function createReferral({
  refCode,
  purchaseSessionId,
  buyerEmail,
  amountPaidCents,
}: CreateReferralInput): Promise<CreateReferralOutcome> {
  const trimmedCode = refCode.trim();
  if (!trimmedCode) return { status: "skipped", reason: "empty_ref" };

  const affiliate = await findAffiliateByCode(trimmedCode);
  if (!affiliate) {
    return { status: "skipped", reason: "unknown_ref_code" };
  }
  if (affiliate.status !== "active") {
    return { status: "skipped", reason: `affiliate_${affiliate.status}` };
  }

  // Self-referral check: compare the ref code's affiliate against the
  // buyer's own (already-ensured) affiliate account. Email match → skip.
  const buyerAffiliate = await findAffiliateByEmail(buyerEmail);
  if (buyerAffiliate && buyerAffiliate.id === affiliate.id) {
    return { status: "skipped", reason: "self_referral" };
  }

  const commissionCents = commissionForAmount(amountPaidCents);
  if (commissionCents <= 0) {
    return { status: "skipped", reason: "no_commission_due" };
  }

  const db = getAdminDb();
  const referralRef = db.collection("referrals").doc(purchaseSessionId);

  try {
    await referralRef.create({
      affiliateId: affiliate.id,
      affiliateCode: affiliate.code,
      purchaseSessionId,
      buyerEmail: buyerEmail.trim().toLowerCase(),
      amountPaidCents: amountPaidCents ?? 0,
      commissionCents,
      status: "pending",
      paidOutAt: null,
      paidOutNote: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // ALREADY_EXISTS (code 6) — duplicate webhook delivery. Idempotent: the
    // referral was already credited on the first run, totals already
    // updated. Just return success without double-incrementing.
    const code = (err as { code?: number })?.code;
    if (code === 6) {
      return {
        status: "credited",
        referralId: purchaseSessionId,
        commissionCents,
      };
    }
    throw err;
  }

  // Atomically bump the affiliate's lifetime totals so the dashboard renders
  // accurate aggregates without a full collection scan. Pending → paid moves
  // happen in a separate admin flow and adjust pendingCommissionCents /
  // paidCommissionCents at that time.
  await db
    .collection("affiliates")
    .doc(affiliate.id)
    .update({
      referralCount: FieldValue.increment(1),
      pendingCommissionCents: FieldValue.increment(commissionCents),
      updatedAt: FieldValue.serverTimestamp(),
    });

  return {
    status: "credited",
    referralId: purchaseSessionId,
    commissionCents,
  };
}
