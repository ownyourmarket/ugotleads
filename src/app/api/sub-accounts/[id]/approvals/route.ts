import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import { getAdminDb } from "@/lib/firebase/admin";

/**
 * GET /api/sub-accounts/[id]/approvals?status=pending|approved|rejected
 *
 * List approval items for the sub-account, sorted by createdAt desc.
 * Optional status filter via query param.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");

  const db = getAdminDb();
  let q = db
    .collection("subAccounts")
    .doc(id)
    .collection("approvals")
    .orderBy("createdAt", "desc")
    .limit(100);

  if (
    statusFilter &&
    ["pending", "approved", "rejected"].includes(statusFilter)
  ) {
    q = q.where("status", "==", statusFilter);
  }

  const snap = await q.get();
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  return NextResponse.json({ items });
}

/**
 * PATCH /api/sub-accounts/[id]/approvals
 *
 * Approve or reject an approval item.
 * Body: { approvalId, action: "approve" | "reject", note?: string }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json()) as {
    approvalId?: string;
    action?: string;
    note?: string;
  };

  if (!body.approvalId || !body.action) {
    return NextResponse.json(
      { error: "approvalId and action are required" },
      { status: 400 },
    );
  }

  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json(
      { error: "action must be 'approve' or 'reject'" },
      { status: 400 },
    );
  }

  const db = getAdminDb();
  const ref = db
    .collection("subAccounts")
    .doc(id)
    .collection("approvals")
    .doc(body.approvalId);

  const doc = await ref.get();
  if (!doc.exists) {
    return NextResponse.json(
      { error: "Approval not found" },
      { status: 404 },
    );
  }

  const update: Record<string, unknown> = {
    status: body.action === "approve" ? "approved" : "rejected",
    reviewedAt: Timestamp.now(),
    reviewedBy: auth.uid,
  };

  if (body.action === "reject" && body.note) {
    update.rejectionNote = body.note.trim().slice(0, 1000);
  }

  await ref.update(update);

  return NextResponse.json({ ok: true, status: update.status });
}
