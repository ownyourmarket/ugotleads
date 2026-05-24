import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import type { Contact } from "@/types/contacts";
import type { MemberStatus, Role } from "@/types";

/**
 * Delete a contact (and its subcollections) plus, optionally, deals/tasks/
 * events that point at it.
 *
 * Auth model: caller must be a sub-account ADMIN of the contact's
 * sub-account (or the agency owner). Collaborators can edit but not
 * delete — matches the rule for `contacts/{id}` where delete requires
 * canAdminSub.
 *
 * Cleanup behaviour (server-side, Admin SDK bypasses rules):
 *   1. Recursive delete of contacts/{id} → wipes /notes and /activities.
 *   2. Delete every deal where contactId matches.
 *   3. Null-out contactId on tasks + events that reference the contact
 *      (don't delete those; they may be useful standalone).
 */

interface CallerClaims {
  status?: MemberStatus;
  agencyId?: string | null;
  agencyRole?: "owner" | "staff" | null;
  role?: Role;
}

async function readCaller(request: Request): Promise<
  | { uid: string; email: string; claims: CallerClaims }
  | NextResponse
> {
  const uid = request.headers.get("x-user-uid");
  if (!uid) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const auth = getAdminAuth();
  const record = await auth.getUser(uid).catch(() => null);
  if (!record) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const claims = (record.customClaims ?? {}) as CallerClaims;
  if (claims.status !== "active") {
    return NextResponse.json({ error: "Account inactive" }, { status: 403 });
  }
  return { uid, email: record.email ?? "", claims };
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const caller = await readCaller(request);
  if (caller instanceof NextResponse) return caller;

  const db = getAdminDb();
  const contactRef = db.doc(`contacts/${id}`);
  const snap = await contactRef.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  const contact = snap.data() as Omit<Contact, "id">;
  const { agencyId, subAccountId } = contact;

  // Authorisation: agency owner of the contact's agency, OR sub-account
  // admin of the contact's sub-account.
  const isAgencyOwner =
    caller.claims.agencyRole === "owner" &&
    caller.claims.agencyId === agencyId;

  let isSubAccountAdmin = false;
  if (!isAgencyOwner) {
    const memberSnap = await db
      .doc(`subAccounts/${subAccountId}/subAccountMembers/${caller.uid}`)
      .get();
    const member = memberSnap.data();
    isSubAccountAdmin =
      memberSnap.exists &&
      member?.status === "active" &&
      member?.role === "admin";
  }

  if (!isAgencyOwner && !isSubAccountAdmin) {
    return NextResponse.json(
      { error: "Only sub-account admins can delete contacts." },
      { status: 403 },
    );
  }

  // 1. Recursive-delete the contact + every subcollection (notes, activities).
  await db.recursiveDelete(contactRef);

  // 2. Delete every deal pointing at this contact.
  const dealsSnap = await db
    .collection("deals")
    .where("subAccountId", "==", subAccountId)
    .where("contactId", "==", id)
    .get();
  let dealsDeleted = 0;
  if (!dealsSnap.empty) {
    const batch = db.batch();
    for (const d of dealsSnap.docs) {
      batch.delete(d.ref);
      dealsDeleted++;
    }
    await batch.commit();
  }

  // 3. Null out contactId on tasks + events that referenced this contact.
  //    Those records may still be useful standalone, so we don't delete
  //    them — just unlink.
  const taskUpdates = await unlinkRefs(db, "tasks", subAccountId, id);
  const eventUpdates = await unlinkRefs(db, "events", subAccountId, id);

  return NextResponse.json({
    ok: true,
    contactId: id,
    dealsDeleted,
    tasksUnlinked: taskUpdates,
    eventsUnlinked: eventUpdates,
  });
}

async function unlinkRefs(
  db: FirebaseFirestore.Firestore,
  collection: "tasks" | "events",
  subAccountId: string,
  contactId: string,
): Promise<number> {
  const snap = await db
    .collection(collection)
    .where("subAccountId", "==", subAccountId)
    .where("contactId", "==", contactId)
    .get();
  if (snap.empty) return 0;
  const batch = db.batch();
  for (const d of snap.docs) {
    batch.update(d.ref, { contactId: null });
  }
  await batch.commit();
  return snap.docs.length;
}
