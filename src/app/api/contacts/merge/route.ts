import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import type { MemberStatus, Role } from "@/types";
import { fireTagAddedTriggers } from "@/lib/automations/tag-triggers";

interface CallerClaims {
  status?: MemberStatus;
  agencyId?: string | null;
  agencyRole?: "owner" | "staff" | null;
  role?: Role;
}

/**
 * POST /api/contacts/merge
 *
 * Merges duplicate contacts into one. The "keep" contact survives; the
 * "remove" contacts have their deals, tasks, events, notes, and activities
 * reassigned to the keeper, then get deleted.
 *
 * Body: { keepId: string, removeIds: string[] }
 */
export async function POST(request: Request) {
  const uid = request.headers.get("x-user-uid");
  if (!uid)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const auth = getAdminAuth();
  const record = await auth.getUser(uid).catch(() => null);
  if (!record)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const claims = (record.customClaims ?? {}) as CallerClaims;
  if (claims.status !== "active")
    return NextResponse.json({ error: "Account inactive" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as {
    keepId?: string;
    removeIds?: string[];
  } | null;

  if (!body?.keepId || !Array.isArray(body.removeIds) || body.removeIds.length === 0) {
    return NextResponse.json(
      { error: "keepId and removeIds[] are required." },
      { status: 400 },
    );
  }

  const { keepId, removeIds } = body;
  if (removeIds.length > 20) {
    return NextResponse.json(
      { error: "Max 20 contacts per merge." },
      { status: 400 },
    );
  }

  const db = getAdminDb();

  // Read the keep contact to verify scope.
  const keepSnap = await db.doc(`contacts/${keepId}`).get();
  if (!keepSnap.exists)
    return NextResponse.json({ error: "Keep contact not found." }, { status: 404 });

  const keepData = keepSnap.data() as { agencyId: string; subAccountId: string; tags?: string[] };
  const { agencyId, subAccountId } = keepData;

  // Auth check.
  const isAgencyOwner =
    claims.agencyRole === "owner" && claims.agencyId === agencyId;
  if (!isAgencyOwner) {
    const memberSnap = await db
      .doc(`subAccounts/${subAccountId}/subAccountMembers/${uid}`)
      .get();
    const m = memberSnap.data();
    if (!memberSnap.exists || m?.status !== "active" || m?.role !== "admin") {
      return NextResponse.json(
        { error: "Only sub-account admins can merge contacts." },
        { status: 403 },
      );
    }
  }

  let dealsReassigned = 0;
  let tasksReassigned = 0;
  let notesMovedTotal = 0;
  let activitiesMovedTotal = 0;
  let deleted = 0;
  const mergedTags = new Set<string>(keepData.tags ?? []);

  for (const removeId of removeIds) {
    const removeRef = db.doc(`contacts/${removeId}`);
    const removeSnap = await removeRef.get();
    if (!removeSnap.exists) continue;
    const removeData = removeSnap.data() as { subAccountId: string; tags?: string[] };
    if (removeData.subAccountId !== subAccountId) continue;

    // Collect tags from the duplicate.
    for (const t of removeData.tags ?? []) mergedTags.add(t);

    // Reassign deals.
    const dealsSnap = await db
      .collection("deals")
      .where("subAccountId", "==", subAccountId)
      .where("contactId", "==", removeId)
      .get();
    for (const d of dealsSnap.docs) {
      await d.ref.update({ contactId: keepId });
      dealsReassigned++;
    }

    // Reassign tasks.
    const tasksSnap = await db
      .collection("tasks")
      .where("subAccountId", "==", subAccountId)
      .where("contactId", "==", removeId)
      .get();
    for (const d of tasksSnap.docs) {
      await d.ref.update({ contactId: keepId });
      tasksReassigned++;
    }

    // Reassign events.
    const eventsSnap = await db
      .collection("events")
      .where("subAccountId", "==", subAccountId)
      .where("contactId", "==", removeId)
      .get();
    for (const d of eventsSnap.docs) {
      await d.ref.update({ contactId: keepId });
    }

    // Move notes to the keep contact's subcollection.
    const notesSnap = await db.collection(`contacts/${removeId}/notes`).get();
    for (const n of notesSnap.docs) {
      await db.collection(`contacts/${keepId}/notes`).add(n.data());
      notesMovedTotal++;
    }

    // Move activities to the keep contact's subcollection.
    const activitiesSnap = await db
      .collection(`contacts/${removeId}/activities`)
      .get();
    for (const a of activitiesSnap.docs) {
      await db.collection(`contacts/${keepId}/activities`).add(a.data());
      activitiesMovedTotal++;
    }

    // Delete the duplicate contact (recursive clears subcollections).
    await db.recursiveDelete(removeRef);
    deleted++;
  }

  // Update tags on the keep contact.
  if (mergedTags.size > (keepData.tags?.length ?? 0)) {
    const finalTags = [...mergedTags];
    await db.doc(`contacts/${keepId}`).update({
      tags: finalTags,
      updatedAt: FieldValue.serverTimestamp(),
    });
    try {
      await fireTagAddedTriggers({
        agencyId,
        subAccountId,
        contactId: keepId,
        addedTags: finalTags,
      });
    } catch (err) {
      console.warn("[contacts/merge] tag triggers failed", err);
    }
  }

  return NextResponse.json({
    ok: true,
    keepId,
    deleted,
    dealsReassigned,
    tasksReassigned,
    notesMoved: notesMovedTotal,
    activitiesMoved: activitiesMovedTotal,
  });
}
