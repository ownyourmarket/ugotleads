// src/lib/firestore/training.ts
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type { TrackProgress, TrackProgressStatus } from "@/types/training";

const TRACK_PROGRESS = "track_progress";

// ---------------------------------------------------------------------------
// ID helper
// ---------------------------------------------------------------------------

export function trackProgressDocId(partnerProfileId: string, trackId: string): string {
  return `${partnerProfileId}_${trackId}`;
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export async function getTrackProgress(
  partnerProfileId: string,
  trackId: string,
): Promise<TrackProgress | null> {
  const snap = await getDoc(
    doc(getFirebaseDb(), TRACK_PROGRESS, trackProgressDocId(partnerProfileId, trackId)),
  );
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<TrackProgress, "id">) };
}

// ---------------------------------------------------------------------------
// Real-time subscriptions
// ---------------------------------------------------------------------------

/**
 * Subscribe to all track_progress docs for a single partner.
 * Used on the /training dashboard to show the partner's status across all tracks.
 */
export function subscribeToPartnerTrackProgress(
  partnerProfileId: string,
  callback: (items: TrackProgress[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), TRACK_PROGRESS),
    where("partnerProfileId", "==", partnerProfileId),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TrackProgress, "id">) }))),
    (err) => onError?.(err),
  );
}

/**
 * Subscribe to all track_progress docs across an agency.
 * Used by the /agency/certifications admin page.
 */
export function subscribeToAgencyTrackProgress(
  agencyId: string,
  callback: (items: TrackProgress[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), TRACK_PROGRESS),
    where("agencyId", "==", agencyId),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TrackProgress, "id">) }))),
    (err) => onError?.(err),
  );
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/**
 * Create or merge a track_progress doc. Safe to call on first module check —
 * if a doc already exists the write merges (existing completedModuleIndices are
 * NOT reset by this call; use updateTrackProgress for targeted updates).
 */
export async function upsertTrackProgress(
  data: Omit<TrackProgress, "id" | "createdAt" | "updatedAt">,
): Promise<void> {
  const id = trackProgressDocId(data.partnerProfileId, data.trackId);
  await setDoc(
    doc(getFirebaseDb(), TRACK_PROGRESS, id),
    {
      ...data,
      id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * Partial update on an existing track_progress doc.
 */
export async function updateTrackProgress(
  id: string,
  data: Partial<Pick<
    TrackProgress,
    | "completedModuleIndices"
    | "totalModules"
    | "status"
    | "completedAt"
    | "approvedAt"
    | "approvedByUid"
    | "revokedAt"
    | "revokedByUid"
  >>,
): Promise<void> {
  await updateDoc(doc(getFirebaseDb(), TRACK_PROGRESS, id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// Status transition helpers (named for clarity at call sites)
// ---------------------------------------------------------------------------

/** Partner submits all modules for admin review. */
export async function submitTrackForReview(progressId: string): Promise<void> {
  await updateTrackProgress(progressId, {
    status: "completed" as TrackProgressStatus,
    completedAt: serverTimestamp(),
  });
}

/** Agency owner approves a completed track. */
export async function approveTrackProgress(
  progressId: string,
  approvedByUid: string,
): Promise<void> {
  await updateTrackProgress(progressId, {
    status: "approved" as TrackProgressStatus,
    approvedAt: serverTimestamp(),
    approvedByUid,
  });
}

/** Agency owner revokes a previously approved track. */
export async function revokeTrackProgress(
  progressId: string,
  revokedByUid: string,
): Promise<void> {
  await updateTrackProgress(progressId, {
    status: "in_progress" as TrackProgressStatus, // revert to editable
    revokedAt: serverTimestamp(),
    revokedByUid,
    approvedAt: null,
    approvedByUid: null,
  });
}
