import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase.js";

// Mirrors src/context/auth-context.tsx's membership subscription path:
// `userMemberships/{uid}/subAccounts`. Doc shape: { subAccountId, agencyId,
// role, name, accountNumber? }.
export async function listSubAccounts(uid) {
  const snap = await getDocs(collection(db, `userMemberships/${uid}/subAccounts`));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Mirrors src/lib/firestore/promptexpert.ts's subscribeToCollection: filter
// by subAccountId only (avoids the subAccountId+updatedAt composite index
// the security rules/listener rely on), sort client-side by updatedAt desc.
async function listScoped(coll, subAccountId) {
  const snap = await getDocs(query(collection(db, coll), where("subAccountId", "==", subAccountId)));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
}

export const listPrompts = (subAccountId) => listScoped("pe_prompts", subAccountId);
export const listGems = (subAccountId) => listScoped("pe_gems", subAccountId);
export const listSkills = (subAccountId) => listScoped("pe_skills", subAccountId);
