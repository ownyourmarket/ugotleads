"use client";

import { useState } from "react";

interface CheckoutResponse {
  url?: string;
  error?: string;
}

interface StartCheckoutOptions {
  /** Promotion code to auto-apply (e.g. "GETLEADSTACK" from the exit
   *  modal). Server validates against Stripe; unknown / expired codes
   *  are silently ignored so checkout still works. */
  discountCode?: string;
}

/**
 * Starts a Stripe Checkout session for the Founders cohort price and
 * redirects the browser to the Stripe-hosted checkout URL. Shared by the
 * navbar Buy Now button, the hero CTA, the pricing card, and the
 * exit-intent modal so all four paths use the same anonymous-checkout
 * endpoint.
 *
 * Each component gets its own `loading` + `error` state because the user
 * needs to see the spinner on whichever button they clicked, not all of
 * them at once.
 */
export function useFoundersCheckout() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(options: StartCheckoutOptions = {}) {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/founders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discountCode: options.discountCode ?? null,
        }),
      });
      const data = (await res.json()) as CheckoutResponse;
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Checkout could not start");
      }
      window.location.href = data.url;
      // Intentionally do not reset loading — the page is navigating away and
      // resetting would flash the button back to its idle state mid-redirect.
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setLoading(false);
    }
  }

  return { startCheckout, loading, error };
}
