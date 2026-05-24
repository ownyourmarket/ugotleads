/**
 * Affiliate `?ref=CODE` cookie constants. Imported by both the client-side
 * RefTracker (which writes the cookie on landing) and the server-side
 * checkout route (which reads the cookie to stamp Stripe metadata). No
 * "server-only" guard here — it's intentionally universal.
 */
export const REF_COOKIE_NAME = "ls_ref";

/** 30-day attribution window — matches the SaaS-affiliate standard. */
export const REF_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
