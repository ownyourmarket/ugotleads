import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

export type NotificationType =
  | "form_submission"
  | "deal_won"
  | "deal_lost"
  | "approval_pending"
  | "escalation"
  | "contact_enriched"
  | "broadcast_complete"
  | "system";

interface CreateNotificationParams {
  subAccountId: string;
  type: NotificationType;
  title: string;
  message: string;
  linkTo?: string;
  metadata?: Record<string, unknown>;
}

export async function createNotification(
  params: CreateNotificationParams,
): Promise<string> {
  const db = getAdminDb();
  const ref = db
    .collection("subAccounts")
    .doc(params.subAccountId)
    .collection("notifications");
  const doc = await ref.add({
    type: params.type,
    title: params.title,
    message: params.message,
    linkTo: params.linkTo ?? null,
    metadata: params.metadata ?? null,
    read: false,
    createdAt: Timestamp.now(),
  });
  return doc.id;
}
