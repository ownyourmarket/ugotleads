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
 * ── Security model ──────────────────────────────────────────────────────────
 *
 * Guard 1 — Environment gate (checked FIRST, before any auth work):
 *   Returns 403 when NODE_ENV === "production" unless the env var
 *   REVENUE_OS_SEED_ALLOW_PRODUCTION=true is explicitly set.
 *   This is the primary production safety net. The same guard lives inside
 *   revenue-os-seeder.ts as a second layer so the seeder function is safe
 *   even if called directly from another code path.
 *
 * Guard 2 — Owner auth gate:
 *   x-user-uid is injected by Next.js middleware (next-firebase-auth-edge)
 *   from a verified Firebase session cookie — it is NOT a raw client-supplied
 *   header in the normal request flow. The middleware strips and re-stamps it.
 *   The uid is then verified against Firebase Admin Auth and custom claims are
 *   checked (agencyRole === "owner", status === "active") before proceeding.
 *   This is the same pattern used by /api/dev-only/danger-wipe-everything.
 *
 * Guard 3 — dryRun default:
 *   dryRun defaults to true at the route layer. To execute real writes the
 *   caller must explicitly pass { "dryRun": false } in the request body.
 *   In production (if Guard 1 is overridden), dryRun: false is additionally
 *   blocked at the route layer unless REVENUE_OS_SEED_ALLOW_PRODUCTION=true.
 *
 * ── Endpoints ───────────────────────────────────────────────────────────────
 *
 * POST /api/dev-only/seed-revenue-os
 *   Body: { "dryRun": true }   → preview only, no Firestore writes (default)
 *   Body: { "dryRun": false }  → writes to Firestore (blocked in prod)
 *
 * DELETE /api/dev-only/seed-revenue-os
 *   Deletes every doc created by the seeder via deterministic slug IDs.
 *   Subject to the same production guard.
 */

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyRole?: "owner" | "staff" | null;
  agencyId?: string | null;
}

/** True when running in a production Firebase project without the explicit override. */
function isProductionLocked(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.REVENUE_OS_SEED_ALLOW_PRODUCTION !== "true"
  );
}

async function requireOwner(
  request: Request,
): Promise<{ uid: string; agencyId: string } | NextResponse> {
  // Guard 1 — block production before touching auth
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

  // Guard 2 — owner auth via middleware-injected uid (not a raw client header)
  const uid = request.headers.get("x-user-uid");
  if (!uid) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Verify uid against Firebase Admin Auth — even if the header were spoofed
  // on a dev machine, this lookup would fail for a non-existent uid.
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

  // Guard 3 — dryRun defaults to true; parse body carefully
  let dryRun = true;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body?.dryRun === "boolean") {
      dryRun = body.dryRun;
    }
  } catch {
    // malformed body — default to dryRun=true (safest path)
  }

  // Additional production gate for dryRun: false at the route layer.
  // The seeder throws the same error, but blocking here produces a cleaner
  // JSON response rather than a 500 with an internal error message.
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
