import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";

export interface AgencyOwnerCaller {
  uid: string;
  agencyId: string;
}

/**
 * Header-auth agency-owner check for dashboard API routes (x-user-uid is
 * set by the session middleware). Single source of truth for "who may
 * manage service keys."
 */
export async function readAgencyOwner(
  request: Request,
): Promise<AgencyOwnerCaller | NextResponse> {
  const uid = request.headers.get("x-user-uid");
  if (!uid) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const record = await getAdminAuth().getUser(uid).catch(() => null);
  if (!record) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const claims = (record.customClaims ?? {}) as {
    status?: string;
    agencyId?: string | null;
    agencyRole?: string | null;
  };
  if (claims.status !== "active")
    return NextResponse.json({ error: "Account inactive" }, { status: 403 });
  if (claims.agencyRole !== "owner" || !claims.agencyId)
    return NextResponse.json({ error: "Agency owner only" }, { status: 403 });
  return { uid, agencyId: claims.agencyId };
}
