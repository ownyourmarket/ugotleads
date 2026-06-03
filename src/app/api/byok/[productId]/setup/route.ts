import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import type { MemberStatus, Role } from "@/types";

/**
 * POST /api/byok/[productId]/setup   — save a partner's BYOK key
 * DELETE /api/byok/[productId]/setup — clear the BYOK key
 *
 * BYOK ("Bring Your Own Key") products require partners to provide their own
 * API key (e.g. OpenAI, Google, or another provider). The platform uses that
 * key on the partner's behalf when they access the product.
 *
 * ── Security model ──────────────────────────────────────────────────────────
 *
 * Guard 1 — Auth: active user, x-user-uid from middleware.
 * Guard 2 — Partner profile: caller must have an active/approved partner profile.
 * Guard 3 — Product: must exist, be BYOK access model, belong to caller's agency.
 * Guard 4 — Eligibility: partner must have an APPROVED eligibility row for this
 *           product. Pending/denied/revoked partners cannot set keys.
 *
 * ── Key storage ─────────────────────────────────────────────────────────────
 *
 * The full key is stored in product_eligibility.byokKey (Admin SDK write only —
 * client SDK can read their own eligibility doc but the UI never displays byokKey).
 * Only byokKeyLast4 is returned to the client and shown in the UI.
 *
 * This is consistent with how other credentials are stored in the codebase
 * (e.g. Twilio tokens in subAccount docs). For higher security, move byokKey
 * to a server-only collection or use a KMS in a future hardening phase.
 *
 * ── What this route does NOT do ─────────────────────────────────────────────
 * - Does NOT validate the key against the third-party API (Phase 17 v1).
 * - Does NOT activate checkout or Stripe.
 * - Does NOT change commission math.
 * - No MLM, genealogy, binary, unilevel, downline, rank, or team-volume logic.
 *
 * ── Request body (POST) ─────────────────────────────────────────────────────
 * { apiKey: string }   — 10–500 chars, trimmed
 */

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyId?: string | null;
}

const MIN_KEY_LENGTH = 10;
const MAX_KEY_LENGTH = 500;

async function resolveCallerAndEligibility(
  request: Request,
  productId: string,
): Promise<
  | {
      ok: true;
      uid: string;
      agencyId: string;
      eligibilityId: string;
    }
  | NextResponse
> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const uid = request.headers.get("x-user-uid");
  if (!uid) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const record = await getAdminAuth().getUser(uid).catch(() => null);
  if (!record) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const claims = (record.customClaims ?? {}) as CallerClaims;
  if (claims.status !== "active") {
    return NextResponse.json({ error: "Account inactive." }, { status: 403 });
  }
  const agencyId = claims.agencyId;
  if (!agencyId) {
    return NextResponse.json({ error: "No agency associated with this account." }, { status: 403 });
  }

  const db = getAdminDb();

  // ── Partner profile check ─────────────────────────────────────────────────
  const partnerSnap = await db.doc(`partner_profiles/${uid}`).get().catch(() => null);
  if (!partnerSnap?.exists) {
    return NextResponse.json(
      { error: "Partner profile not found. You must be enrolled as a partner." },
      { status: 404 },
    );
  }
  const partner = partnerSnap.data() as { status: string; agencyId: string };
  if (partner.agencyId !== agencyId) {
    return NextResponse.json({ error: "Agency mismatch." }, { status: 403 });
  }
  if (partner.status !== "active" && partner.status !== "approved") {
    return NextResponse.json(
      { error: `Partner status "${partner.status}" is not eligible for BYOK setup.` },
      { status: 403 },
    );
  }

  // ── Product check ─────────────────────────────────────────────────────────
  const productSnap = await db.doc(`products/${productId}`).get().catch(() => null);
  if (!productSnap?.exists) {
    return NextResponse.json(
      { error: `Product ${productId} not found.` },
      { status: 404 },
    );
  }
  const product = productSnap.data() as { agencyId: string; accessModel: string; status: string };
  if (product.agencyId !== agencyId) {
    return NextResponse.json({ error: "Product does not belong to your agency." }, { status: 403 });
  }
  if (product.accessModel !== "byok") {
    return NextResponse.json(
      {
        error: "This product does not use the BYOK access model.",
        accessModel: product.accessModel,
      },
      { status: 422 },
    );
  }
  if (product.status === "archived") {
    return NextResponse.json({ error: "Product is archived." }, { status: 422 });
  }

  // ── Eligibility check ─────────────────────────────────────────────────────
  const eligibilityId = `${uid}_${productId}`;
  const eligibilitySnap = await db.doc(`product_eligibility/${eligibilityId}`).get().catch(() => null);
  if (!eligibilitySnap?.exists) {
    return NextResponse.json(
      {
        error: "No eligibility record found for this product.",
        note: "You need an approved eligibility row before you can configure a BYOK key. Contact your agency owner.",
      },
      { status: 403 },
    );
  }
  const eligibility = eligibilitySnap.data() as { status: string };
  if (eligibility.status !== "approved") {
    return NextResponse.json(
      {
        error: `Eligibility status is "${eligibility.status}" — must be "approved" before configuring a BYOK key.`,
      },
      { status: 403 },
    );
  }

  return { ok: true, uid, agencyId, eligibilityId };
}

// ---------------------------------------------------------------------------
// POST — save BYOK key
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const { productId } = await params;

  const resolved = await resolveCallerAndEligibility(request, productId);
  if (resolved instanceof NextResponse) return resolved;
  const { uid, eligibilityId } = resolved;

  // Parse body
  let body: { apiKey?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const rawKey = body.apiKey ?? "";
  const apiKey = rawKey.trim();

  if (apiKey.length < MIN_KEY_LENGTH) {
    return NextResponse.json(
      { error: `API key must be at least ${MIN_KEY_LENGTH} characters.` },
      { status: 400 },
    );
  }
  if (apiKey.length > MAX_KEY_LENGTH) {
    return NextResponse.json(
      { error: `API key must be ≤${MAX_KEY_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const byokKeyLast4 = apiKey.slice(-4);
  const db = getAdminDb();

  await db.doc(`product_eligibility/${eligibilityId}`).update({
    byokKey: apiKey,
    byokKeyLast4,
    byokKeyValidatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.info(
    `[byok] Partner ${uid} saved BYOK key for product ${productId} (last4: ${byokKeyLast4})`,
  );

  return NextResponse.json({
    ok: true,
    productId,
    byokKeyLast4,
    message: "API key saved. Only the last 4 characters are shown for security.",
  });
}

// ---------------------------------------------------------------------------
// DELETE — clear BYOK key
// ---------------------------------------------------------------------------

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const { productId } = await params;

  const resolved = await resolveCallerAndEligibility(request, productId);
  if (resolved instanceof NextResponse) return resolved;
  const { uid, eligibilityId } = resolved;

  const db = getAdminDb();

  await db.doc(`product_eligibility/${eligibilityId}`).update({
    byokKey: null,
    byokKeyLast4: null,
    byokKeyValidatedAt: null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.info(`[byok] Partner ${uid} cleared BYOK key for product ${productId}`);

  return NextResponse.json({
    ok: true,
    productId,
    message: "API key removed.",
  });
}
