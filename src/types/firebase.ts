export type SubscriptionStatus =
  | "active"
  | "canceled"
  | "past_due"
  | "trialing"
  | "inactive";

export type Role = "admin" | "collaborator";

export type MemberStatus = "active" | "removed";

export interface UserDoc {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  // Legacy billing fields. In the agency model, billing lives on AgencyDoc.
  // Kept here for back-compat during Phase 1/2; will be removed in Phase 6.
  stripeCustomerId: string | null;
  subscriptionStatus: SubscriptionStatus;
  subscriptionPriceId: string | null;
  // Legacy single-tenant role. Sub-account roles live on SubAccountMemberDoc.
  role: Role;
  status: MemberStatus;
  // Tenancy: which agency this user was minted into (their "home" agency).
  primaryAgencyId: string | null;
  // Revenue OS extensions — null on all pre-existing users
  /**
   * Legal full name. Separate from displayName (public alias).
   * Set when a user submits a partner application.
   */
  fullName: string | null;
  /**
   * partner_profiles/{id} this user is linked to.
   * Set when the partner application is submitted.
   */
  partnerProfileId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppConfig {
  // Legacy single-tenant fields — kept while Phase 1 lives alongside the
  // existing dashboard. Phase 6 drops them.
  adminUid: string;
  adminEmail: string;
  // Agency-model bootstrap markers — set on first signup.
  firstAgencyId: string;
  firstAgencyOwnerUid: string;
  bootstrapEmail: string;
  createdAt: Date;
}

export interface InviteDoc {
  email: string;
  invitedByUid: string;
  createdAt: Date;
  acceptedByUid: string | null;
  acceptedAt: Date | null;
}
