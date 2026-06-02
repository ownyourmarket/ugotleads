"use client";

import { useEffect } from "react";
import {
  PARTNER_REF_COOKIE_NAME,
  PARTNER_REF_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/partner-referral/cookie";

/**
 * PartnerRefTracker
 *
 * Runs on every page. Reads `?ref=CODE` from the URL and stores it in a
 * 30-day cookie (`myusa_partner_ref`) so the value survives across visits
 * and is attached to the signup at account-creation time.
 *
 * Last-click attribution: every new visit with a `?ref=` overwrites the
 * existing cookie. Visits without `?ref=` leave the cookie untouched.
 *
 * This is the MyUSA Partner system only.
 * It is completely separate from the LeadStack founders affiliate system
 * (`ls_ref` / `referrals` collection) which is gated on LANDING_VARIANT
 * === "leadstack" and uses a different cookie name.
 *
 * No beacon or server-side call is made here — the cookie is the attribution
 * mechanism. The signup API route reads it at account-creation time.
 */
export function PartnerRefTracker() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const raw = params.get("ref");
    if (!raw) return;

    // Normalise: uppercase + trim, cap at 32 chars to match referralCode format.
    const code = raw.trim().toUpperCase().slice(0, 32);
    if (!code) return;

    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie =
      [
        `${PARTNER_REF_COOKIE_NAME}=${encodeURIComponent(code)}`,
        `Max-Age=${PARTNER_REF_COOKIE_MAX_AGE_SECONDS}`,
        `Path=/`,
        `SameSite=Lax`,
      ].join("; ") + secure;
  }, []);

  return null;
}
