import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { seedRevenueOs, rollbackRevenueOs } from "@/lib/seed/revenue-os-seeder";
import type { MemberStatus, Role } from "@/types";

/**
 * Dev-only Revenue OS seed endpoint.
 *
 * Seeds the product catalog, partner tracks, and commission rules for the
 * MyUSA Local / uGotLeads Revenue OS. All writes use deterministic doc IDs
 * so the operation is fully idempotent.
 *
 * Guards (ALL must pass):
 *   1. NODE_ENV !== "production"  OR  REVENUE_OS_SEED_ALLOW_PRODUCTION=true
 *   2. Caller must be the agency owner (checked via Firebase custom claims)
 *
 * POST /api/dev-only/seed-revenue-os
 *   Body: { "dryRun": true }   → preview only, no Firestore writes (default)
 *   Body: { "dryRun": false }  → writes to Firestore
 *
 * DELETE /api/dev-only/seed-revenue-os
 *   Deletes every doc created by the seeder using the deterministic slug IDs.
 *   Subject to the same production guard.
 */

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyRole?: "owner" | "staff" | null;
  agencyId?: string | null;
}

async function requireOwner(
  request: Request,
): Promise<{ uid: string; agencyId: string } | NextResponse> {
  // Production guard — checked here AND inside the seeder for defence in depth.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.REVENUE_OS_SEED_ALLOW_PRODUCTION !== "true"
  ) {
    return NextResponse.json(
      {
        error:
          "Disabled in production. Set REVENUE_OS_SEED_ALLOW_PRODUCTION=true to override.",
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
      { error: "Only the agency owner can run the Revenue OS seeder." },
      { status: 403 },
    );
  }

  return { uid, agencyId: claims.agencyId };
}

export async function POST(request: Request) {
  const access = await requireOwner(request);
  if (access instanceof NextResponse) return access;

  let dryRun = true;
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body?.dryRun === "boolean") dryRun = body.dryRun;
  } catch {
    // malformed body — default to dryRun=true (safe)
  }

  try {
    const result = await seedRevenueOs(
      getAdminDb(),
      access.agencyId,
      access.uid,
      dryRun,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Seed failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const access = await requireOwner(request);
  if (access instanceof NextResponse) return access;

  try {
    const result = await rollbackRevenueOs(getAdminDb());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Rollback failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
