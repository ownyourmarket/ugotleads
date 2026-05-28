import { NextResponse, type NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const db = getAdminDb();
  const notifCol = db
    .collection("subAccounts")
    .doc(id)
    .collection("notifications");

  if (body.markAllRead) {
    const unread = await notifCol.where("read", "==", false).get();
    if (!unread.empty) {
      const batch = db.batch();
      for (const doc of unread.docs) {
        batch.update(doc.ref, { read: true });
      }
      await batch.commit();
    }
    return NextResponse.json({ updated: unread.size });
  }

  if (Array.isArray(body.notificationIds) && body.notificationIds.length > 0) {
    const batch = db.batch();
    for (const notifId of body.notificationIds.slice(0, 100)) {
      if (typeof notifId !== "string") continue;
      batch.update(notifCol.doc(notifId), { read: true });
    }
    await batch.commit();
    return NextResponse.json({ updated: body.notificationIds.length });
  }

  return NextResponse.json(
    { error: { code: "BAD_REQUEST", message: "Provide notificationIds or markAllRead" } },
    { status: 400 },
  );
}
