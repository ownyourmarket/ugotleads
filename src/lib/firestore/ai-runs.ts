// src/lib/firestore/ai-runs.ts
import {
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  orderBy,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type { AiRun } from "@/types/ledger";

const AI_RUNS = "ai_runs";

export async function createAiRun(data: Omit<AiRun, "id" | "createdAt">): Promise<string> {
  const ref = await addDoc(collection(getFirebaseDb(), AI_RUNS), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export function subscribeToAiRuns(
  subAccountId: string,
  callback: (runs: AiRun[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), AI_RUNS),
    where("subAccountId", "==", subAccountId),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AiRun, "id">) }))),
    (err) => onError?.(err),
  );
}

export function subscribeToPartnerAiRuns(
  partnerProfileId: string,
  callback: (runs: AiRun[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), AI_RUNS),
    where("partnerProfileId", "==", partnerProfileId),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AiRun, "id">) }))),
    (err) => onError?.(err),
  );
}
