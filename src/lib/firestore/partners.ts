// src/lib/firestore/partners.ts
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  orderBy,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type {
  PartnerProfile,
  PartnerTrack,
  Certification,
  PartnerStatus,
  PartnerTier,
} from "@/types/partner";

const PARTNER_PROFILES = "partner_profiles";
const PARTNER_TRACKS = "partner_tracks";
const CERTIFICATIONS = "certifications";

// ---------------------------------------------------------------------------
// partner_profiles  (doc id === uid)
// ---------------------------------------------------------------------------

export async function getPartnerProfile(uid: string): Promise<PartnerProfile | null> {
  const snap = await getDoc(doc(getFirebaseDb(), PARTNER_PROFILES, uid));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<PartnerProfile, "id">) };
}

export function subscribeToPartnerProfile(
  uid: string,
  callback: (profile: PartnerProfile | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getFirebaseDb(), PARTNER_PROFILES, uid),
    (snap) => {
      if (!snap.exists()) { callback(null); return; }
      callback({ id: snap.id, ...(snap.data() as Omit<PartnerProfile, "id">) });
    },
    (err) => onError?.(err),
  );
}

export function subscribeToPartnerProfiles(
  agencyId: string,
  callback: (profiles: PartnerProfile[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), PARTNER_PROFILES),
    where("agencyId", "==", agencyId),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PartnerProfile, "id">) }))),
    (err) => onError?.(err),
  );
}

export async function getPartnersByStatus(
  agencyId: string,
  status: PartnerStatus,
): Promise<PartnerProfile[]> {
  const q = query(
    collection(getFirebaseDb(), PARTNER_PROFILES),
    where("agencyId", "==", agencyId),
    where("status", "==", status),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PartnerProfile, "id">) }));
}

export async function getPartnersByTier(
  agencyId: string,
  tier: PartnerTier,
): Promise<PartnerProfile[]> {
  const q = query(
    collection(getFirebaseDb(), PARTNER_PROFILES),
    where("agencyId", "==", agencyId),
    where("tier", "==", tier),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PartnerProfile, "id">) }));
}

export type CreatePartnerProfileData = Omit<
  PartnerProfile,
  "id" | "createdAt" | "updatedAt" | "lifetimeCommissionCents" | "pendingCommissionCents"
>;

export async function createPartnerProfile(
  uid: string,
  data: CreatePartnerProfileData,
): Promise<void> {
  await setDoc(doc(getFirebaseDb(), PARTNER_PROFILES, uid), {
    ...data,
    lifetimeCommissionCents: 0,
    pendingCommissionCents: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updatePartnerProfile(
  uid: string,
  data: Partial<Pick<
    PartnerProfile,
    | "status" | "tier" | "accessModel" | "territory" | "city" | "state"
    | "phone" | "displayName" | "subAccountId" | "activeTrackId"
    | "stripeSubscriptionId" | "approvedByUid" | "approvedAt" | "internalNotes"
  >>,
): Promise<void> {
  await updateDoc(doc(getFirebaseDb(), PARTNER_PROFILES, uid), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// partner_tracks
// ---------------------------------------------------------------------------

export function subscribeToPartnerTracks(
  agencyId: string,
  callback: (tracks: PartnerTrack[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), PARTNER_TRACKS),
    where("agencyId", "==", agencyId),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PartnerTrack, "id">) }))),
    (err) => onError?.(err),
  );
}

export async function createPartnerTrack(
  data: Omit<PartnerTrack, "id" | "createdAt" | "updatedAt">,
): Promise<string> {
  const ref = await addDoc(collection(getFirebaseDb(), PARTNER_TRACKS), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

// ---------------------------------------------------------------------------
// certifications
// ---------------------------------------------------------------------------

export function subscribeToCertifications(
  agencyId: string,
  callback: (certs: Certification[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), CERTIFICATIONS),
    where("agencyId", "==", agencyId),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Certification, "id">) }))),
    (err) => onError?.(err),
  );
}

export async function createCertification(
  data: Omit<Certification, "id" | "createdAt" | "updatedAt">,
): Promise<string> {
  const ref = await addDoc(collection(getFirebaseDb(), CERTIFICATIONS), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}
