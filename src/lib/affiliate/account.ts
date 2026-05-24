import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COMMISSION_PCT, generateAffiliateCode } from "@/lib/affiliate/codes";
import type { Affiliate } from "@/types/affiliate";

interface EnsureAccountInput {
  email: string;
  displayName?: string | null;
}

/**
 * Idempotently creates an affiliate account for the given email and returns
 * it. Called from the Stripe webhook after a successful founders purchase,
 * gated on LANDING_VARIANT === "leadstack".
 *
 * Lookup uses a `where("email", "==", ...)` query rather than a deterministic
 * doc id so emails can change without breaking attribution (Stripe lets
 * customers update their email post-purchase).
 *
 * Concurrent calls for the same email could race; if two webhook deliveries
 * land simultaneously we'd create two affiliate docs. Mitigated by the
 * webhook's purchases/{sessionId}.create() idempotency guard upstream —
 * a single buyer can only trigger this once per session.
 */
export async function ensureAffiliateAccount({
  email,
  displayName,
}: EnsureAccountInput): Promise<Affiliate> {
  const db = getAdminDb();
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await db
    .collection("affiliates")
    .where("email", "==", normalizedEmail)
    .limit(1)
    .get();

  if (!existing.empty) {
    const doc = existing.docs[0];
    return { id: doc.id, ...(doc.data() as Omit<Affiliate, "id">) };
  }

  const code = generateAffiliateCode(normalizedEmail);
  const docRef = await db.collection("affiliates").add({
    email: normalizedEmail,
    code,
    displayName: displayName?.trim() || null,
    status: "active",
    commissionPct: COMMISSION_PCT,
    referralCount: 0,
    pendingCommissionCents: 0,
    paidCommissionCents: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const snap = await docRef.get();
  return { id: docRef.id, ...(snap.data() as Omit<Affiliate, "id">) };
}

/**
 * Looks up an affiliate by code (used during checkout when stamping the
 * referrer onto Stripe metadata, and during referral creation to resolve
 * the ref code back to the actual affiliate doc).
 */
export async function findAffiliateByCode(
  code: string,
): Promise<Affiliate | null> {
  const db = getAdminDb();
  const snap = await db
    .collection("affiliates")
    .where("code", "==", code.trim())
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...(doc.data() as Omit<Affiliate, "id">) };
}

export async function findAffiliateByEmail(
  email: string,
): Promise<Affiliate | null> {
  const db = getAdminDb();
  const snap = await db
    .collection("affiliates")
    .where("email", "==", email.trim().toLowerCase())
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...(doc.data() as Omit<Affiliate, "id">) };
}
