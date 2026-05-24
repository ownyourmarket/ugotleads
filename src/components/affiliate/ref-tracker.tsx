"use client";

import { useEffect } from "react";
import { LANDING_VARIANT } from "@/config/landing";
import {
  REF_COOKIE_MAX_AGE_SECONDS,
  REF_COOKIE_NAME,
} from "@/lib/affiliate/ref-cookie";

/**
 * Reads `?ref=CODE` from the current URL and stores it in a 30-day cookie
 * so the value survives across visits and lands on the Stripe checkout
 * route at purchase time.
 *
 * Last-click attribution: every new visit with a `?ref=` overwrites the
 * cookie. Visits without a `?ref=` leave the existing cookie untouched.
 *
 * Gated on LANDING_VARIANT — buyer clones (LANDING_VARIANT === "custom")
 * dead-code-eliminate the entire body at build time because the check
 * is a top-level const, so their bundle ships effectively empty.
 */
export function RefTracker() {
  useEffect(() => {
    if (LANDING_VARIANT !== "leadstack") return;
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const raw = params.get("ref");
    if (!raw) return;

    const code = raw.trim().slice(0, 64);
    if (!code) return;

    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = [
      `${REF_COOKIE_NAME}=${encodeURIComponent(code)}`,
      `Max-Age=${REF_COOKIE_MAX_AGE_SECONDS}`,
      `Path=/`,
      `SameSite=Lax`,
    ].join("; ") + secure;

    // Fire the click beacon to the server. Best-effort: failures don't
    // affect attribution (the cookie is already set; the purchase webhook
    // is what credits referrals). The server dedupes one click per IP per
    // day per code, so repeat visits are cheap.
    fetch("/api/affiliate/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        code,
        landingPath: window.location.pathname + window.location.search,
        referrer: document.referrer || null,
      }),
    }).catch(() => {
      // Swallow — the cookie is what actually drives attribution. Beacon
      // is analytics-only.
    });
  }, []);

  return null;
}
