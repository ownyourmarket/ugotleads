import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { seedPartnerEligibility } from "@/lib/seed/revenue-os-seeder";
import { FieldValue } from "firebase-admin/firestore";
import type { MemberStatus, Role } from "@/types";

/**
 * Dev-only: Bootstrap the logged-in agency owner as a test partner.
 *
 * Creates or updates:
 *   - partner_profiles/{uid}  with status "active", tier "certified",
 *     completedTrackIds for both Certified AI Consultant and Support Local
 *     Community Advocate, and activeTrackId set to AI Consultant.
 *   - product_eligibility/{uid}_{productId} for every template in
 *     SEED_ELIGIBILITY_TEMPLATES, with status derived from completedTrackIds.
 *
 * ── Security model ──────────────────────────────────────────────────────────
 *
 * Guard 1 — Environment gate:
 *   Returns 403 when NODE_ENV === "production" unless
 *   REVENUE_OS_SEED_ALLOW_PRODUCTION=true is explicitly set.
 *
 * Guard 2 — Owner auth gate:
 *   x-user-uid is injected by Next.js middleware (next-firebase-auth-edge)
 *   from a verified Firebase session cookie — NOT a raw client header.
 *   Verified against Firebase Admin Auth; agencyRole must be "owner".
 *
 * Guard 3 — dryRun default:
 *   dryRun defaults to true. Pass { "dryRun": false } to perform real writes.
 *
 * ── Endpoint ────────────────────────────────────────────────────────────────
 *
 * POST /api/dev-only/bootstrap-partner
 *   Body: { "dryRun": true }   → preview only, no writes (default)
 *   Body: { "dryRun": false }  → creates/updates partner profile + eligibility
 *
 * ── Usage (browser DevTools console) ────────────────────────────────────────
 *
 *   // Dry-run first:
 *   fetch('/api/dev-only/bootstrap-partner', {
 *     method: 'POST',
 *     credentials: 'include',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ dryRun: true }),
 *   }).then(r => r.json()).then(console.log);
 *
 *   // Live write:
 *   fetch('/api/dev-only/bootstrap-partner', {
 *     method: 'POST',
 *     credentials: 'include',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ dryRun: false }),
 *   }).then(r => r.json()).then(console.log);
 */

// Track IDs mirror the deterministic slugs from revenue-os-seeder.ts
const TRACK_AI_CONSULTANT = "track_certified_ai_consultant";
const TRACK_COMMUNITY_ADVOCATE = "track_community_advocate";

// The two tracks awarded to a bootstrapped test partner
const BOOTSTRAP_COMPLETED_TRACKS = [TRACK_AI_CONSULTANT, TRACK_COMMUNITY_ADVOCATE];

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyRole?: "owner" | "staff" | null;
  agencyId?: string | null;
}

function isProductionLocked(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.REVENUE_OS_SEED_ALLOW_PRODUCTION !== "true"
  );
}

async function requireOwner(
  request: Request,
): Promise<{ uid: string; agencyId: string } | NextResponse> {
  if (isProductionLocked()) {
    return NextResponse.json(
      {
        error:
          "Disabled in production. " +
          "Set REVENUE_OS_SEED_ALLOW_PRODUCTION=true to explicitly override.",
      },
      { status: 403 },
    );
  }

  const uid = request.headers.get("x-user-uid");
  if (!uid) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const record = await getAdminAuth().getUser(uid).catch(() => null);
  if (!record) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const claims = (record.customClaims ?? {}) as CallerClaims;
  if (claims.status !== "active") {
    return NextResponse.json({ error: "Account inactive." }, { status: 403 });
  }
  if (claims.agencyRole !== "owner" || !claims.agencyId) {
    return NextResponse.json(
      { error: "Only the agency owner can bootstrap a test partner." },
      { status: 403 },
    );
  }

  return { uid, agencyId: claims.agencyId };
}

export async function POST(request: Request) {
  const access = await requireOwner(request);
  if (access instanceof NextResponse) return access;

  // Guard 3 — dryRun defaults to true
  let dryRun = true;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body?.dryRun === "boolean") {
      dryRun = body.dryRun;
    }
  } catch {
    // malformed body — default to dryRun=true
  }

  if (!dryRun && isProductionLocked()) {
    return NextResponse.json(
      {
        error:
          "dryRun: false is blocked in production. " +
          "Set REVENUE_OS_SEED_ALLOW_PRODUCTION=true to explicitly override.",
      },
      { status: 403 },
    );
  }

  const db = getAdminDb();
  const { uid, agencyId } = access;
  const now = FieldValue.serverTimestamp();

  // ---- Partner profile payload ----
  const partnerProfilePayload = {
    uid,
    agencyId,
    email: (await getAdminAuth().getUser(uid)).email ?? "",
    fullName: (await getAdminAuth().getUser(uid)).displayName ?? "Test Partner",
    displayName: null,
    phone: null,
    city: null,
    state: null,
    country: "US",
    territory: null,
    status: "active" as const,
    tier: "certified" as const,
    accessModel: "credit" as const,
    stripeSubscriptionId: null,
    subAccountId: null,
    activeTrackId: TRACK_AI_CONSULTANT,
    completedTrackIds: BOOTSTRAP_COMPLETED_TRACKS,
    referralCode: uid.slice(0, 8).toUpperCase(),
    lifetimeCommissionCents: 0,
    pendingCommissionCents: 0,
    approvedByUid: uid,
    approvedAt: now,
    internalNotes: "Bootstrapped via /api/dev-only/bootstrap-partner",
    updatedAt: now,
  };

  // ---- Dry-run preview ----
  if (dryRun) {
    const eligibilityPreview = await seedPartnerEligibility(
      db,
      agencyId,
      uid,
      BOOTSTRAP_COMPLETED_TRACKS,
      true, // dryRun
    );

    const profileDocSnap = await db.collection("partner_profiles").doc(uid).get();

    return NextResponse.json({
      ok: true,
      dryRun: true,
      partnerProfile: {
        collection: "partner_profiles",
        docId: uid,
        action: profileDocSnap.exists ? "overwrite" : "create",
        status: partnerProfilePayload.status,
        tier: partnerProfilePayload.tier,
        completedTrackIds: partnerProfilePayload.completedTrackIds,
        activeTrackId: partnerProfilePayload.activeTrackId,
        referralCode: partnerProfilePayload.referralCode,
      },
      eligibility: eligibilityPreview,
    });
  }

  // ---- Live write ----
  try {
    // Check if profile doc already exists — use setDoc(merge) to preserve
    // fields we don't want to clobber (e.g. lifetimeCommissionCents built up
    // by real activity).
    const profileDocSnap = await db.collection("partner_profiles").doc(uid).get();
    const profileAction = profileDocSnap.exists ? "overwrite" : "create";

    if (profileDocSnap.exists) {
      // Merge: update only status/tier/tracks/approval — preserve commission totals
      await db.collection("partner_profiles").doc(uid).update({
        status: partnerProfilePayload.status,
        tier: partnerProfilePayload.tier,
        accessModel: partnerProfilePayload.accessModel,
        activeTrackId: partnerProfilePayload.activeTrackId,
        completedTrackIds: partnerProfilePayload.completedTrackIds,
        referralCode: partnerProfilePayload.referralCode,
        approvedByUid: partnerProfilePayload.approvedByUid,
        approvedAt: partnerProfilePayload.approvedAt,
        internalNotes: partnerProfilePayload.internalNotes,
        updatedAt: partnerProfilePayload.updatedAt,
        _seedTag: "revenue_os_v1",
      });
    } else {
      await db.collection("partner_profiles").doc(uid).set({
        ...partnerProfilePayload,
        createdAt: now,
        _seedTag: "revenue_os_v1",
      });
    }

    // Seed eligibility docs
    const eligibilityResult = await seedPartnerEligibility(
      db,
      agencyId,
      uid,
      BOOTSTRAP_COMPLETED_TRACKS,
      false, // live write
    );

    return NextResponse.json({
      ok: true,
      dryRun: false,
      partnerProfile: {
        collection: "partner_profiles",
        docId: uid,
        action: profileAction,
        status: partnerProfilePayload.status,
        tier: partnerProfilePayload.tier,
        completedTrackIds: partnerProfilePayload.completedTrackIds,
        activeTrackId: partnerProfilePayload.activeTrackId,
        referralCode: partnerProfilePayload.referralCode,
      },
      eligibility: eligibilityResult,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bootstrap failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
