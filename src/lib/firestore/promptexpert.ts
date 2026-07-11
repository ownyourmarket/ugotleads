import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type {
  TenantScope,
  PePrompt,
  PeGem,
  PeSkill,
  GemType,
  SkillOutputFormat,
} from "@/types";

const PE_PROMPTS = "pe_prompts";
const PE_GEMS = "pe_gems";
const PE_SKILLS = "pe_skills";

function toMillis(v: unknown): number {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  const maybe = v as { toDate?: () => Date; seconds?: number };
  if (typeof maybe.toDate === "function") return maybe.toDate().getTime();
  if (typeof maybe.seconds === "number") return maybe.seconds * 1000;
  return 0;
}

// Filter by subAccountId so security rules accept the listener and the
// data is scoped to the active sub-account. Sort client-side to avoid the
// subAccountId+updatedAt composite index.
function subscribeToCollection<T extends { id: string; updatedAt: unknown }>(
  coll: string,
  scope: TenantScope,
  callback: (rows: T[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), coll),
    where("subAccountId", "==", scope.subAccountId),
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Omit<T, "id">) }) as T,
      );
      rows.sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
      callback(rows);
    },
    (err) => onError?.(err),
  );
}

export function subscribeToPePrompts(
  scope: TenantScope,
  callback: (rows: PePrompt[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return subscribeToCollection<PePrompt>(PE_PROMPTS, scope, callback, onError);
}

export function subscribeToPeGems(
  scope: TenantScope,
  callback: (rows: PeGem[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return subscribeToCollection<PeGem>(PE_GEMS, scope, callback, onError);
}

export function subscribeToPeSkills(
  scope: TenantScope,
  callback: (rows: PeSkill[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return subscribeToCollection<PeSkill>(PE_SKILLS, scope, callback, onError);
}

async function createDoc(
  coll: string,
  scope: TenantScope,
  createdByUid: string,
  data: Record<string, unknown>,
): Promise<string> {
  const ref = await addDoc(collection(getFirebaseDb(), coll), {
    ...data,
    agencyId: scope.agencyId,
    subAccountId: scope.subAccountId,
    createdByUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

async function updateDocPatch(
  coll: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await updateDoc(doc(getFirebaseDb(), coll, id), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function createPePrompt(
  scope: TenantScope,
  uid: string,
  data: { title: string; content: string; category: string; tags: string[] },
): Promise<string> {
  return createDoc(PE_PROMPTS, scope, uid, data);
}

export async function updatePePrompt(
  _scope: TenantScope,
  id: string,
  patch: Partial<Pick<PePrompt, "title" | "content" | "category" | "tags">>,
): Promise<void> {
  return updateDocPatch(PE_PROMPTS, id, patch);
}

export async function createPeGem(
  scope: TenantScope,
  uid: string,
  data: { name: string; gemType: GemType; dataContent: string },
): Promise<string> {
  return createDoc(PE_GEMS, scope, uid, data);
}

export async function updatePeGem(
  _scope: TenantScope,
  id: string,
  patch: Partial<Pick<PeGem, "name" | "gemType" | "dataContent">>,
): Promise<void> {
  return updateDocPatch(PE_GEMS, id, patch);
}

export async function createPeSkill(
  scope: TenantScope,
  uid: string,
  data: {
    name: string;
    description: string | null;
    systemInstruction: string;
    outputFormat: SkillOutputFormat;
    creditCost: number;
  },
): Promise<string> {
  return createDoc(PE_SKILLS, scope, uid, data);
}

export async function updatePeSkill(
  _scope: TenantScope,
  id: string,
  patch: Partial<
    Pick<
      PeSkill,
      "name" | "description" | "systemInstruction" | "outputFormat" | "creditCost"
    >
  >,
): Promise<void> {
  return updateDocPatch(PE_SKILLS, id, patch);
}
