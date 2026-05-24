export type AgencyRole = "owner" | "staff";
export type SubAccountRole = "admin" | "collaborator";
export type SubAccountStatus = "active" | "archived";

import type { SubscriptionStatus, MemberStatus } from "./firebase";

export interface AgencyDoc {
  id: string;
  name: string;
  ownerUid: string;
  createdAt: Date;
  updatedAt: Date;
  // Billing lives at agency scope.
  stripeCustomerId: string | null;
  subscriptionStatus: SubscriptionStatus;
  subscriptionPriceId: string | null;
  /**
   * Optional URL of the agency's logo. When set, the dashboard sidebar +
   * browser tab title swap LeadStack's chevron mark + wordmark for the
   * agency's brand. The URL is rendered as <img src="…" />, so any public
   * https URL works (CDN, S3, the agency's own site). Null = LeadStack's
   * default mark.
   */
  logoUrl: string | null;
  /**
   * Public support / contact email for the agency. Surfaced on the custom
   * landing page ("Talk to us" CTAs, FAQ "email us" line, footer). Null
   * falls back to CUSTOM_BRAND.supportEmail from src/config/landing.ts.
   */
  supportEmail: string | null;
  /**
   * Agency's public domain — used in landing footer + canonical URL. No
   * scheme, no trailing slash (e.g. "leadmachine.com"). Null falls back to
   * CUSTOM_BRAND.primaryDomain.
   */
  primaryDomain: string | null;
}

export interface SubAccountDoc {
  id: string;
  agencyId: string;
  /**
   * Sequential, human-readable identifier per agency. Assigned at creation
   * via a counter doc at agencies/{agencyId}/counters/subAccount, starting
   * at 1000 (so Main = 1000, next = 1001, ...). Doc IDs in URLs are still
   * Firestore auto-IDs; this number is a UI-only label.
   */
  accountNumber: number;
  name: string;
  slug: string;
  status: SubAccountStatus;
  timezone: string;
  createdByUid: string;
  createdAt: Date;
  updatedAt: Date;
  // Reserved for the upcoming Workflow Recipes feature. Populated null/empty in
  // v1; the per-sub-account credential UI lands when Workflows ships.
  twilioConfig: TwilioConfig | null;
  resendConfig: ResendConfig | null;
  bookingConfig: BookingConfig | null;
  sendWindow: SendWindow | null;
  /**
   * Generic booking-page URL surfaced via the {{bookingLink}} merge tag in
   * email + SMS templates. Calendly is the canonical case but any URL works
   * (Cal.com, TidyCal, SavvyCal, Stripe Payment Link, etc.). Null when the
   * sub-account hasn't set one — {{bookingLink}} resolves to empty string.
   */
  bookingLink: string | null;
  /**
   * Single source of truth for the Reply-To header on every email LeadStack
   * sends on behalf of this sub-account — automation lead-step emails AND
   * manual contact-profile sends. Null falls back to no Reply-To (current
   * default behavior). One address per sub-account by design — keeps
   * replies from one client landing consistently in one inbox regardless
   * of which teammate triggered the send.
   */
  replyToEmail: string | null;
  /**
   * Sub-account-level kill switch for the automation engine. When true:
   *   - fireTriggers() returns early without creating any execution docs
   *   - in-flight executions short-circuit at their next step with
   *     skippedReason: "automation_disabled"
   * Reset to false to resume firing. Defaults to false on creation; the
   * "Pause all automations" toggle on the Automations page drives it.
   */
  automationsPaused: boolean;
  /**
   * Primary point of contact at the client this sub-account belongs to —
   * the person the agency speaks to about this workspace. All fields
   * optional. Sub-accounts used for internal teams (not external clients)
   * can leave this null entirely. Surfaced on the sub-account dashboard
   * as a slim header strip and edited from Settings.
   */
  accountContact: AccountContact | null;
}

export interface AccountContact {
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface TwilioConfig {
  /**
   * Master toggle for the dedicated-SMS feature on this sub-account. When
   * true, outbound + inbound SMS use the credentials below and the contact
   * profile renders the Messages tab + chat thread. When false (or this
   * whole config is null), the deployment falls back to the env-var
   * Twilio (existing shared-sender behavior). Strictly additive — flipping
   * this off restores the prior experience.
   */
  enabled: boolean;
  accountSid: string;
  authToken: string;
  /** E.164 (e.g. "+15551234567"). The number this sub-account sends from. */
  fromNumber: string;
  /**
   * True once we've called Twilio's IncomingPhoneNumbers API and set the
   * inbound smsUrl for `fromNumber` to point at our /api/webhooks/twilio/inbound
   * endpoint. False if auto-config failed (operator must configure manually).
   */
  inboundWebhookConfigured: boolean;
  /** Last time we successfully called Twilio's /Accounts/{sid} with the saved creds. */
  lastValidatedAt: Date | null;
  /**
   * Reserved for future use — a per-sub-account secret used to extra-verify
   * inbound webhooks beyond Twilio's signature. Null in v1; we rely on
   * Twilio's standard signature verification with `authToken`.
   */
  inboundWebhookSecret: string | null;
}

export interface ResendConfig {
  apiKey: string;
  verifiedSenderDomain: string;
  emailFrom: string;
}

export interface BookingConfig {
  defaultPageSlug: string;
  types: Array<{ slug: string; label: string; durationMinutes: number }>;
}

export interface SendWindow {
  startHour: number;
  endHour: number;
  timezone: string;
}

export interface AgencyMemberDoc {
  uid: string;
  agencyId: string;
  role: AgencyRole;
  status: MemberStatus;
  email: string;
  displayName: string;
  addedAt: Date;
  addedByUid: string;
}

export interface SubAccountMemberDoc {
  uid: string;
  subAccountId: string;
  agencyId: string;
  role: SubAccountRole;
  status: MemberStatus;
  email: string;
  displayName: string;
  addedAt: Date;
  addedByUid: string;
}

export interface InviteDocV2 {
  id: string;
  email: string;
  agencyId: string;
  subAccountId: string | null;
  subAccountRole: SubAccountRole | null;
  agencyRole: AgencyRole | null;
  invitedByUid: string;
  createdAt: Date;
  acceptedByUid: string | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export interface UserSubAccountMembership {
  subAccountId: string;
  agencyId: string;
  role: SubAccountRole;
  name: string;
  /**
   * Mirror of SubAccountDoc.accountNumber. May be undefined for sub-accounts
   * created before the numbering migration; UI should fall back gracefully.
   */
  accountNumber?: number;
  addedAt: Date;
}

export interface UserAgencyMembership {
  agencyId: string;
  role: AgencyRole;
  name: string;
}

export interface TenantScope {
  agencyId: string;
  subAccountId: string;
}
