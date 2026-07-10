import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const uid = request.headers.get("x-user-uid");
  if (!uid) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const record = await getAdminAuth().getUser(uid).catch(() => null);
  const claims = (record?.customClaims ?? {}) as {
    status?: string;
    agencyId?: string | null;
    agencyRole?: string | null;
  };
  if (claims.status !== "active")
    return NextResponse.json({ error: "Account inactive" }, { status: 403 });
  if (claims.agencyRole !== "owner" || !claims.agencyId)
    return NextResponse.json({ error: "Agency owner only" }, { status: 403 });

  const db = getAdminDb();
  const ref = db.doc(`agencyServiceKeys/${id}`);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.agencyId !== claims.agencyId) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  await ref.update({ status: "revoked" });
  return NextResponse.json({ data: { id, status: "revoked" } });
}
