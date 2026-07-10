import "server-only";

import { NextResponse } from "next/server";
import { readAgencyOwner } from "@/lib/auth/read-agency-owner";
import { getAdminDb } from "@/lib/firebase/admin";

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const owner = await readAgencyOwner(request);
  if (owner instanceof NextResponse) return owner;

  const db = getAdminDb();
  const ref = db.doc(`agencyServiceKeys/${id}`);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.agencyId !== owner.agencyId) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  await ref.update({ status: "revoked" });
  return NextResponse.json({ data: { id, status: "revoked" } });
}
