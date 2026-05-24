import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import { addActivity } from "@/lib/firestore/activities";
import type { Deal, DealFormData, PipelineStageId } from "@/types/deals";
import { getStage } from "@/types/deals";
import type { TenantScope } from "@/types";

const DEALS = "deals";

export function subscribeToDeals(
  scope: TenantScope,
  callback: (deals: Deal[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), DEALS),
    where("subAccountId", "==", scope.subAccountId),
  );
  return onSnapshot(
    q,
    (snap) => {
      const deals = snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Omit<Deal, "id">) }),
      );
      deals.sort(
        (a, b) => toMillis(b.stageChangedAt) - toMillis(a.stageChangedAt),
      );
      callback(deals);
    },
    (err) => onError?.(err),
  );
}

export function subscribeToDealsForContact(
  contactId: string,
  scope: TenantScope,
  callback: (deals: Deal[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), DEALS),
    where("subAccountId", "==", scope.subAccountId),
    where("contactId", "==", contactId),
  );
  return onSnapshot(
    q,
    (snap) => {
      const deals = snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Omit<Deal, "id">) }),
      );
      deals.sort(
        (a, b) => toMillis(b.stageChangedAt) - toMillis(a.stageChangedAt),
      );
      callback(deals);
    },
    (err) => onError?.(err),
  );
}

export async function createDeal(
  scope: TenantScope,
  createdByUid: string,
  data: DealFormData,
): Promise<string> {
  const ref = await addDoc(collection(getFirebaseDb(), DEALS), {
    ...data,
    agencyId: scope.agencyId,
    subAccountId: scope.subAccountId,
    createdByUid,
    lostReason: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    stageChangedAt: serverTimestamp(),
  });
  await addActivity(data.contactId, {
    type: "pipeline_moved",
    createdBy: createdByUid,
    content: `Deal "${data.title}" created in ${getStage(data.stageId).label}`,
    meta: { dealId: ref.id, toStageId: data.stageId },
  });
  return ref.id;
}

export async function updateDeal(
  id: string,
  data: Partial<Omit<DealFormData, "contactId">>,
): Promise<void> {
  await updateDoc(doc(getFirebaseDb(), DEALS, id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function moveDeal(
  deal: Deal,
  newStageId: PipelineStageId,
  opts: { userId: string; lostReason?: string },
): Promise<void> {
  if (deal.stageId === newStageId) return;
  const patch: Record<string, unknown> = {
    stageId: newStageId,
    updatedAt: serverTimestamp(),
    stageChangedAt: serverTimestamp(),
  };
  if (newStageId === "lost") {
    patch.lostReason = opts.lostReason?.trim() || null;
  } else if (deal.stageId === "lost") {
    patch.lostReason = null;
  }
  await updateDoc(doc(getFirebaseDb(), DEALS, deal.id), patch);
  await addActivity(deal.contactId, {
    type: "pipeline_moved",
    createdBy: opts.userId,
    content: `Deal "${deal.title}" moved from ${getStage(deal.stageId).label} to ${getStage(newStageId).label}${
      newStageId === "lost" && opts.lostReason ? ` — ${opts.lostReason}` : ""
    }`,
    meta: {
      dealId: deal.id,
      fromStageId: deal.stageId,
      toStageId: newStageId,
    },
  });
}

export async function deleteDeal(id: string): Promise<void> {
  await deleteDoc(doc(getFirebaseDb(), DEALS, id));
}

function toMillis(v: unknown): number {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  const maybe = v as { toDate?: () => Date; seconds?: number };
  if (typeof maybe.toDate === "function") return maybe.toDate().getTime();
  if (typeof maybe.seconds === "number") return maybe.seconds * 1000;
  return 0;
}
