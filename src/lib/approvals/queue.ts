import "server-only";

import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

export type ApprovalType =
  | "social-post"
  | "ai-reply"
  | "broadcast"
  | "enrichment";

interface QueueForApprovalParams {
  subAccountId: string;
  agencyId: string;
  type: ApprovalType;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  submittedBy: string;
}

/**
 * Create an approval doc in Firestore for human review.
 * Returns the auto-generated approval document ID.
 */
export async function queueForApproval(
  params: QueueForApprovalParams,
): Promise<string> {
  const db = getAdminDb();
  const ref = db
    .collection("subAccounts")
    .doc(params.subAccountId)
    .collection("approvals");

  const doc = await ref.add({
    agencyId: params.agencyId,
    subAccountId: params.subAccountId,
    type: params.type,
    title: params.title,
    content: params.content,
    metadata: params.metadata ?? null,
    submittedBy: params.submittedBy,
    status: "pending",
    createdAt: Timestamp.now(),
    reviewedAt: null,
    reviewedBy: null,
    rejectionNote: null,
  });

  return doc.id;
}
