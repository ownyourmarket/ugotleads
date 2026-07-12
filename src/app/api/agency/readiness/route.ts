import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { computeReadiness } from "@/lib/readiness/compute";
import type { MemberStatus, Role } from "@/types";

/**
 * GET /api/agency/readiness
 *
 * Owner-gated production-readiness snapshot. Combines server-only env-flag
 * presence (never the secret values) with point-in-time data checks (products,
 * purchases, commissions) into a single checklist the cockpit renders.
 *
 * Computation lives in src/lib/readiness/compute.ts, shared with the agent
 * control-plane routes so the two surfaces can never drift.
 *
 * ── Security ────────────────────────────────────────────────────────────────
 * Auth → active → agencyRole === "owner". Data reads scoped to caller's agency.
 *
 * ── Privacy ─────────────────────────────────────────────────────────────────
 * Returns booleans only for secrets (set / not set, test vs live prefix).
 * Never returns key material.
 *
 * ── Not auto-detectable ───────────────────────────────────────────────────────
 * Firestore rules-deployed and indexes-deployed cannot be reliably detected from
 * app code, so they are returned as "info" items the owner confirms manually.
 *
 * No checkout/Stripe activation, no commission math, no MLM logic.
 */

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyRole?: "owner" | "staff" | null;
  agencyId?: string | null;
}

export async function GET(request: Request) {
  // Auth + role
  const uid = request.headers.get("x-user-uid");
  if (!uid) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const record = await getAdminAuth().getUser(uid).catch(() => null);
  if (!record) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const claims = (record.customClaims ?? {}) as CallerClaims;
  if (claims.status !== "active") return NextResponse.json({ error: "Account inactive." }, { status: 403 });
  if (claims.agencyRole !== "owner" || !claims.agencyId) {
    return NextResponse.json({ error: "Agency owner access required." }, { status: 403 });
  }

  const result = await computeReadiness(getAdminDb(), claims.agencyId);

  return NextResponse.json({ ok: true, ...result });
}
