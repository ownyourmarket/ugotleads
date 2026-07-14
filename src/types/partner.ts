// src/types/partner.ts
import type { Timestamp, FieldValue } from "firebase/firestore";
import type { AccessModel } from "./products";

/**
 * A licensed partner in the agency's partner network.
 * Doc id === uid — lookups by uid need no index.
 * Collection: partner_profiles/{uid}
 */
export type PartnerStatus =
  | "applied"       // application submitted, awaiting review
  | "approved"      // approved, not yet onboarded
  | "active"        // operating
  | "suspended"     // temporarily blocked
  | "terminated";   // permanent

export type PartnerTier =
  | "community"     // entry-level, credit-based access
  | "operator"      // monthly/yearly subscription
  | "certified"     // completed at least one track
  | "elite";        // invitation-only top tier

export interface PartnerProfile {
  id: string;                    // === uid
  uid: string;
  agencyId: string;
  email: string;
  fullName: string;
  displayName: string | null;    // public alias; falls back to fullName
  phone: string | null;
  city: string | null;
  state: string | null;
  country: string;               // ISO 3166-1 alpha-2
  territory: string | null;      // e.g. "North Atlanta"
  status: PartnerStatus;
  tier: PartnerTier;
  accessModel: AccessModel;
  /** Stripe subscription id when accessModel === "subscription". */
  stripeSubscriptionId: string | null;
  /**
   * The sub-account this partner operates.
   * Mirrors an existing subAccounts/{id} doc — that doc's planMode,
   * subscriptionTier, and byokEnabled fields are the workspace state.
   */
  subAccountId: string | null;
  /** partner_tracks/{id} currently enrolled in or most recently active. */
  activeTrackId: string | null;
  /**
   * All track IDs the partner has completed.
   * Used for multi-track detection (Certified AI Consultant + Community Advocate).
   * Defaults to [] when no tracks are completed.
   * Extend by appending the track id on completion — do not replace.
   *
   * NOTE: this field was added in revenue_os_v2. Partners created before this
   * field will have it missing/undefined — treat as [].
   */
  completedTrackIds: string[];
  /**
   * Short uppercase code used in referral links: /?ref=CODE
   * Generated at profile creation / bootstrap. Null on profiles that pre-date
   * this field — treat as "not yet assigned".
   */
  referralCode: string | null;
  /**
   * Per-partner override of the tier's default client-workspace allowance
   * (see src/lib/tiers/capabilities.ts). Null / undefined = use the tier
   * default. Set by the agency owner to grant extra (or fewer) workspaces
   * without changing the partner's tier.
   */
  maxClientWorkspacesOverride?: number | null;
  lifetimeCommissionCents: number;
  pendingCommissionCents: number;
  approvedByUid: string | null;
  approvedAt: Timestamp | FieldValue | null;
  internalNotes: string | null;  // agency-owner visible only
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

/**
 * A structured onboarding/certification curriculum.
 * Collection: partner_tracks/{id}
 */
export type TrackStatus = "draft" | "active" | "archived";

export interface PartnerTrack {
  id: string;
  agencyId: string;
  name: string;
  description: string | null;
  status: TrackStatus;
  /** Ordered milestone labels. Completion tracking is a v2 feature. */
  milestones: string[];
  /** Days from enrollment until expiry. 0 = no expiry. */
  durationDays: number;
  /** certifications/{id} awarded on completion. */
  certificationId: string | null;
  createdByUid: string;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

/**
 * A credential/badge awarded when a partner completes a track.
 * Collection: certifications/{id}
 */
export interface Certification {
  id: string;
  agencyId: string;
  name: string;
  description: string | null;
  badgeUrl: string | null;
  trackId: string;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}
