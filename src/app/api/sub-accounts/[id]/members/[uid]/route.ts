import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";

/**
 * Sub-account-level member management.
 *
 * PATCH — change role (admin <-> collaborator). Caller must be agency
 *   owner or sub-account admin.
 * DELETE — remove a member from the sub-account. Sets the membership doc's
 *   status to "removed", deletes the user's switcher index entry, and (if
 *   the user has zero remaining active memberships) flips their global
 *   user.status to "removed" and disables the Firebase Auth user. The
 *   AuthContext force-signs-out on the next page load.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; uid: string }> },
) {
  const { id: subAccountId, uid: targetUid } = await ctx.params;
  const access = await requireSubAccountAdmin(request, subAccountId);
  if (access instanceof NextResponse) return access;

  let body: { role?: "admin" | "collaborator" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const role: "admin" | "collaborator" =
    body.role === "admin" ? "admin" : "collaborator";

  const db = getAdminDb();
  const memberRef = db.doc(
    `subAccounts/${subAccountId}/subAccountMembers/${targetUid}`,
  );
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) {
    return NextResponse.json({ error: "Not a member" }, { status: 404 });
  }

  const indexRef = db.doc(
    `userMemberships/${targetUid}/subAccounts/${subAccountId}`,
  );

  await db.batch().update(memberRef, { role }).update(indexRef, { role }).commit();

  return NextResponse.json({ ok: true, uid: targetUid, role });
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string; uid: string }> },
) {
  const { id: subAccountId, uid: targetUid } = await ctx.params;
  const access = await requireSubAccountAdmin(request, subAccountId);
  if (access instanceof NextResponse) return access;

  if (targetUid === access.uid) {
    return NextResponse.json(
      { error: "You can't remove yourself. Ask the agency owner." },
      { status: 400 },
    );
  }

  const db = getAdminDb();
  const memberRef = db.doc(
    `subAccounts/${subAccountId}/subAccountMembers/${targetUid}`,
  );
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) {
    return NextResponse.json({ error: "Not a member" }, { status: 404 });
  }

  // 1. Flip the membership row to "removed" and drop the index entry.
  const batch = db.batch();
  batch.update(memberRef, {
    status: "removed",
    removedAt: FieldValue.serverTimestamp(),
  });
  batch.delete(
    db.doc(`userMemberships/${targetUid}/subAccounts/${subAccountId}`),
  );
  await batch.commit();

  // 2. If the user has no remaining active memberships AND no agency role,
  //    disable them globally.
  const remaining = await db
    .collectionGroup("subAccountMembers")
    .where("uid", "==", targetUid)
    .where("status", "==", "active")
    .limit(1)
    .get();

  let globallyRemoved = false;
  if (remaining.empty) {
    const userSnap = await db.doc(`users/${targetUid}`).get();
    const userData = userSnap.data() ?? {};
    const agencyId = userData.primaryAgencyId as string | null | undefined;

    let isAgencyOwner = false;
    if (agencyId) {
      const ownerSnap = await db
        .doc(`agencies/${agencyId}/agencyMembers/${targetUid}`)
        .get();
      const ownerData = ownerSnap.data() ?? {};
      isAgencyOwner = ownerData.role === "owner" && ownerData.status === "active";
    }

    if (!isAgencyOwner) {
      globallyRemoved = true;
      await db.doc(`users/${targetUid}`).update({
        status: "removed",
        updatedAt: FieldValue.serverTimestamp(),
      });
      const auth = getAdminAuth();
      const existing = await auth.getUser(targetUid).catch(() => null);
      const claims = (existing?.customClaims ?? {}) as Record<string, unknown>;
      await auth.setCustomUserClaims(targetUid, {
        ...claims,
        status: "removed",
      });
      await auth.updateUser(targetUid, { disabled: true }).catch(() => undefined);
    }
  }

  return NextResponse.json({ ok: true, uid: targetUid, globallyRemoved });
}
