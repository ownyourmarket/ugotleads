export type AgencyRole = "owner" | "staff";
export type SubAccountRole = "admin" | "collaborator";
export type SubAccountStatus = "active" | "archived";

import type { SubscriptionStatus, MemberStatus } from "./firebase";

/**
 * Which Revenue OS access model a sub-account's operator is on.
 * Mirrors AccessModel from products.ts — duplicated here so tenancy.ts
 * (imported across the whole app) does not depend on the new type files.
 */
export type PlanMode = "credit" | "subscription" | "byok";

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
   * browser tab title swap UGotLeads's chevron mark + wordmark for the
   * agency's brand. The URL is rendered as <img src="…" />, so any public
   * https URL works (CDN, S3, the agency's own site). Null = UGotLeads's
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
   * Single source of truth for the Reply-To header on every email UGotLeads
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
  /**
   * AI provider configuration — chooses between the agency's hosted
   * OpenRouter key (default, subject to monthly token cap baked into tier
   * price) and the operator's own OpenRouter key (BYOK, no cap).
   * Null on legacy docs; the resolver treats null as `{ mode: "hosted" }`.
   * See docs/ai-provider-billing-spec.md for full design.
   */
  aiProvider: AiProviderConfig | null;
  /**
   * Zernio Profile ID paired 1:1 with this sub-account. Created lazily
   * on first social-account connect via /api/sub-accounts/[id]/zernio/
   * provision. Null on sub-accounts that haven't touched social yet.
   * Used by /v1/profiles/{id}/* calls when proxying through Zernio.
   */
  zernioProfileId: string | null;
  // Revenue OS extensions — null/false on all pre-existing sub-accounts.
  // The CRM is unaffected when these are null.
  /**
   * Which access model the operator is on. Null = legacy (treat as
   * "subscription" for any Revenue OS logic that needs a default).
   */
  planMode: PlanMode | null;
  /**
   * Human-readable tier label, e.g. "Operator Pro". UI display only.
   */
  subscriptionTier: string | null;
  /**
   * True when aiProvider.mode === "byok" AND the key has been validated.
   * Cached flag — source of truth is aiProvider.byokKey. Set by server only.
   */
  byokEnabled: boolean;
  /**
   * Rolling token usage for the current billing period. The
   * /api/cron/ai-usage-reset job snapshots + zeroes this every ~30 days.
   * Null on legacy docs; the resolver lazy-initialises on first read.
   */
  aiUsage: AiUsageState | null;
  /**
   * Set at signup when the new user arrived via a MyUSA partner referral link
   * (?ref=CODE). Stores the partner_profiles/{uid} doc id of the referring
   * partner so commission events can be attributed later.
   *
   * Null on sub-accounts created before referral capture was introduced, or
   * when the user signed up without a referral link.
   *
   * This is the MyUSA Partner system only. Do NOT confuse with the LeadStack
   * founders affiliate `referrals` collection.
   */
  referredByPartnerProfileId: string | null;
}

export type AiProviderMode = "hosted" | "byok";

export interface AiProviderConfig {
  mode: AiProviderMode;
  /**
   * Operator-provided OpenRouter key when mode === "byok". v1 stores
   * plaintext — encryption (KMS or Vercel symmetric) is a follow-up.
   * NEVER returned to clients in API responses; UI shows `byokKeyLast4`.
   */
  byokKey: string | null;
  /** Last 4 chars of the BYOK key for UI display. Safe to expose. */
  byokKeyLast4: string | null;
  /** Last successful validation against OpenRouter. */
  byokKeyValidatedAt: Date | null;
}

export interface AiUsageState {
  /** Tokens used in the current billing period. Reset monthly by cron. */
  currentPeriodTokens: number;
  /** Start of the current rolling period. */
  currentPeriodStart: Date;
  /**
   * Cached cap for the current tier. Refreshed by the monthly reset cron
   * + on tier upgrade via Stripe webhook. Hosted mode only.
   */
  monthlyCapTokens: number;
  /** Lifetime tokens across all periods. Never reset. */
  lifetimeTokens: number;
  /** Last time we sent the "near cap" / "cap reached" warning email. */
  lastWarningAt: Date | null;
  /**
   * Which threshold warnings we've already emailed for the current
   * billing period — e.g. `["80"]` means we sent the 80% notice but not
   * the 100% one. Cleared by the monthly reset cron.
   */
  warningsSentThisPeriod: ("80" | "100")[];
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
