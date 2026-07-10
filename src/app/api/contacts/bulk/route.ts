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

async function readCaller(request: Request) {
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
  return { uid, claims };
}

/**
 * POST /api/contacts/bulk
 *
 * Body: { action: "tag" | "delete", contactIds: string[], tag?: string }
 *
 * Auth: caller must be sub-account admin of every contact's sub-account
 * (or the agency owner). For simplicity, we read the first contact's
 * sub-account and verify access once — all contacts must share the same
 * sub-account (the UI only selects within one sub-account).
 */
export async function POST(request: Request) {
  const caller = await readCaller(request);
  if (caller instanceof NextResponse) return caller;

  const body = (await request.json().catch(() => null)) as {
    action?: string;
    contactIds?: string[];
    tag?: string;
  } | null;

  if (
    !body ||
    !body.action ||
    !Array.isArray(body.contactIds) ||
    body.contactIds.length === 0
  ) {
    return NextResponse.json(
      { error: "action and contactIds[] are required." },
      { status: 400 }
    );
  }

  const { action, contactIds, tag } = body;
  if (contactIds.length > 200) {
    return NextResponse.json(
      { error: "Max 200 contacts per bulk action." },
      { status: 400 }
    );
  }

  const db = getAdminDb();

  // Read the first contact to determine sub-account scope.
  const firstSnap = await db.doc(`contacts/${contactIds[0]}`).get();
  if (!firstSnap.exists) {
    return NextResponse.json({ error: "Contact not found." }, { status: 404 });
  }
  const { agencyId, subAccountId } = firstSnap.data() as {
    agencyId: string;
    subAccountId: string;
  };

  // Auth check.
  const isAgencyOwner =
    caller.claims.agencyRole === "owner" && caller.claims.agencyId === agencyId;
  if (!isAgencyOwner) {
    const memberSnap = await db
      .doc(`subAccounts/${subAccountId}/subAccountMembers/${caller.uid}`)
      .get();
    const m = memberSnap.data();
    if (!memberSnap.exists || m?.status !== "active" || m?.role !== "admin") {
      return NextResponse.json(
        { error: "Only sub-account admins can perform bulk actions." },
        { status: 403 }
      );
    }
  }

  if (action === "tag") {
    if (!tag || typeof tag !== "string" || !tag.trim()) {
      return NextResponse.json({ error: "tag is required." }, { status: 400 });
    }
    const trimmed = tag.trim().slice(0, 50);
    let updated = 0;

    // Batch in groups of 500 (Firestore batch limit).
    for (let i = 0; i < contactIds.length; i += 500) {
      const batch = db.batch();
      const chunk = contactIds.slice(i, i + 500);
      for (const id of chunk) {
        batch.update(db.doc(`contacts/${id}`), {
          tags: FieldValue.arrayUnion(trimmed),
          updatedAt: FieldValue.serverTimestamp(),
        });
        updated++;
      }
      await batch.commit();
    }

    for (const id of contactIds) {
      try {
        await fireTagAddedTriggers({
          agencyId,
          subAccountId,
          contactId: id,
          addedTags: [trimmed],
        });
      } catch (err) {
        console.warn("[contacts/bulk] tag triggers failed", err);
      }
    }

    return NextResponse.json({ ok: true, updated });
  }

  if (action === "delete") {
    let deleted = 0;

    for (const id of contactIds) {
      const ref = db.doc(`contacts/${id}`);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const data = snap.data() as { subAccountId: string };
      // Only delete contacts from the same sub-account.
      if (data.subAccountId !== subAccountId) continue;

      // Recursive delete (wipes notes + activities subcollections).
      await db.recursiveDelete(ref);

      // Delete referencing deals.
      const dealsSnap = await db
        .collection("deals")
        .where("subAccountId", "==", subAccountId)
        .where("contactId", "==", id)
        .get();
      if (!dealsSnap.empty) {
        const batch = db.batch();
        for (const d of dealsSnap.docs) batch.delete(d.ref);
        await batch.commit();
      }

      // Unlink tasks + events.
      for (const col of ["tasks", "events"] as const) {
        const s = await db
          .collection(col)
          .where("subAccountId", "==", subAccountId)
          .where("contactId", "==", id)
          .get();
        if (!s.empty) {
          const batch = db.batch();
          for (const d of s.docs) batch.update(d.ref, { contactId: null });
          await batch.commit();
        }
      }

      deleted++;
    }

    return NextResponse.json({ ok: true, deleted });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
