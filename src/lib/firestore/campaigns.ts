// src/lib/firestore/campaigns.ts
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  orderBy,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type { Campaign, CampaignMetrics } from "@/types/ledger";
import type { TenantScope } from "@/types";

const CAMPAIGNS = "campaigns";

export function subscribeToCampaigns(
  scope: TenantScope,
  callback: (campaigns: Campaign[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), CAMPAIGNS),
    where("subAccountId", "==", scope.subAccountId),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Campaign, "id">) }))),
    (err) => onError?.(err),
  );
}

export async function createCampaign(
  scope: TenantScope,
  createdByUid: string,
  data: Omit<Campaign, "id" | "agencyId" | "subAccountId" | "createdByUid" | "spentCents" | "metrics" | "createdAt" | "updatedAt">,
): Promise<string> {
  const ref = await addDoc(collection(getFirebaseDb(), CAMPAIGNS), {
    ...data,
    agencyId: scope.agencyId,
    subAccountId: scope.subAccountId,
    createdByUid,
    spentCents: 0,
    metrics: {
      sent: 0, delivered: 0, opened: 0, clicked: 0, converted: 0, leads: 0,
    } as CampaignMetrics,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateCampaign(
  id: string,
  data: Partial<Pick<
    Campaign,
    "name" | "status" | "description" | "startDate" | "endDate" | "budgetCents" | "spentCents" | "metrics"
  >>,
): Promise<void> {
  await updateDoc(doc(getFirebaseDb(), CAMPAIGNS, id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}
