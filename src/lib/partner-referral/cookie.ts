/**
 * MyUSA Partner Referral cookie constants.
 *
 * Distinct from the LeadStack founders-affiliate system (ls_ref / referrals
 * collection). These constants are used by:
 *   - PartnerRefTracker (client — writes the cookie on landing)
 *   - /api/auth/signup (server — reads the cookie to stamp attribution)
 *
 * Not server-only — intentionally universal so both sides can import it.
 */

/** Cookie name written when a visitor lands with ?ref=CODE. */
export const PARTNER_REF_COOKIE_NAME = "myusa_partner_ref";

/** 30-day attribution window. Overwrites on each new ?ref= visit. */
export const PARTNER_REF_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
