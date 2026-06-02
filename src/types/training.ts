// src/types/training.ts
import type { Timestamp, FieldValue } from "firebase/firestore";

/**
 * Lifecycle of a partner's progress through a certification track.
 *
 * "in_progress" — partner has started (checked at least one module)
 * "completed"   — partner has checked every module and submitted for review
 * "approved"    — agency owner approved; track ID written to PartnerProfile.completedTrackIds
 * "revoked"     — was approved, agency owner revoked the certification
 *
 * A missing doc (no record) means "not_started" — inferred at runtime, never stored.
 */
export type TrackProgressStatus = "in_progress" | "completed" | "approved" | "revoked";

/**
 * One per partner × track. Records which modules have been checked and the
 * approval state.
 *
 * Doc id: `${partnerProfileId}_${trackId}`
 * Collection: track_progress/{id}
 *
 * ── Approval flow ──────────────────────────────────────────────────────────
 * 1. Partner marks modules complete on the training page → completedModuleIndices grows.
 * 2. When all modules are checked the partner can "Submit for review" → status = "completed".
 * 3. Agency owner sees it in /agency/certifications and clicks Approve → status = "approved".
 * 4. On approval the calling code ALSO calls updatePartnerProfile to append trackId
 *    to completedTrackIds and auto-approves eligible product eligibility rows.
 *
 * ── What is NOT in scope ─────────────────────────────────────────────────
 * No MLM, genealogy, binary, unilevel, downline, rank bonus, team volume, or
 * compensation plan logic. Progress tracks certification only.
 */
export interface TrackProgress {
  id: string;                             // `${partnerProfileId}_${trackId}`
  agencyId: string;
  partnerProfileId: string;
  uid: string;                            // Firebase user uid
  trackId: string;
  /** certifications/{id} linked to this track, if any. Null otherwise. */
  certificationId: string | null;
  /** 0-based indices of modules the partner has ticked off. */
  completedModuleIndices: number[];
  /** Denormalized total so progress % can be computed without the track doc. */
  totalModules: number;
  status: TrackProgressStatus;
  /** Set when partner submits all modules for review. */
  completedAt: Timestamp | FieldValue | null;
  /** Set when agency owner approves the completion. */
  approvedAt: Timestamp | FieldValue | null;
  approvedByUid: string | null;
  revokedAt: Timestamp | FieldValue | null;
  revokedByUid: string | null;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}
