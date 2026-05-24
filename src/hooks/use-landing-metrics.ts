"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebaseDb, isFirebaseConfigured } from "@/lib/firebase/client";
import type { HeroVariantId } from "@/lib/hero-variants";

export interface LandingMetricsState {
  pageViews: number;
  ctaClicks: number;
  /** Per-variant page-view counts. Undefined keys = no traffic on that
   *  variant yet (Firestore field doesn't exist). */
  pageViewsByVariant: Partial<Record<HeroVariantId, number>>;
  ctaClicksByVariant: Partial<Record<HeroVariantId, number>>;
  hydrated: boolean;
}

const DEFAULTS: LandingMetricsState = {
  pageViews: 0,
  ctaClicks: 0,
  pageViewsByVariant: {},
  ctaClicksByVariant: {},
  hydrated: false,
};

const PAGEVIEW_SESSION_KEY = "leadstack:landing:pageView";

async function postEvent(
  event: "pageView" | "ctaClick",
  variant?: HeroVariantId,
) {
  try {
    await fetch("/api/landing/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, variant }),
      keepalive: true,
    });
  } catch {
    // Counters are best-effort; a single dropped event is fine.
  }
}

function readVariantCounts(
  data: Record<string, unknown>,
  field: "pageViews" | "ctaClicks",
): Partial<Record<HeroVariantId, number>> {
  const out: Partial<Record<HeroVariantId, number>> = {};
  for (const v of ["A", "B", "C"] as HeroVariantId[]) {
    const raw = data[`${field}_${v}`];
    if (typeof raw === "number") out[v] = raw;
  }
  return out;
}

/**
 * Subscribes to the public landing-metrics doc, fires a pageView once per
 * browser session (bucketed by the active hero variant), and returns a
 * `trackCta()` callback that also passes the variant. Session-storage
 * dedupe keeps refresh-spamming honest without blocking returning visits
 * in new sessions.
 */
export function useLandingMetrics(
  variant?: HeroVariantId,
): LandingMetricsState & {
  trackCta: () => void;
} {
  const [state, setState] = useState<LandingMetricsState>(DEFAULTS);
  const pageViewFiredRef = useRef(false);
  // Cache the variant in a ref so trackCta closures don't get stale.
  const variantRef = useRef<HeroVariantId | undefined>(variant);
  useEffect(() => {
    variantRef.current = variant;
  }, [variant]);

  useEffect(() => {
    // Fire pageView once per session, regardless of whether Firebase is
    // configured (the server route handles the increment).
    if (!pageViewFiredRef.current) {
      pageViewFiredRef.current = true;
      let alreadyFired = false;
      try {
        alreadyFired = sessionStorage.getItem(PAGEVIEW_SESSION_KEY) === "1";
        if (!alreadyFired) sessionStorage.setItem(PAGEVIEW_SESSION_KEY, "1");
      } catch {
        // sessionStorage unavailable (private mode) — fire anyway.
      }
      if (!alreadyFired) void postEvent("pageView", variantRef.current);
    }

    if (!isFirebaseConfigured()) {
      setState({ ...DEFAULTS, hydrated: true });
      return;
    }

    let db;
    try {
      db = getFirebaseDb();
    } catch {
      setState({ ...DEFAULTS, hydrated: true });
      return;
    }

    const ref = doc(db, "appConfig/landingMetrics");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setState({ ...DEFAULTS, hydrated: true });
          return;
        }
        const data = snap.data() as Record<string, unknown>;
        setState({
          pageViews: typeof data.pageViews === "number" ? data.pageViews : 0,
          ctaClicks: typeof data.ctaClicks === "number" ? data.ctaClicks : 0,
          pageViewsByVariant: readVariantCounts(data, "pageViews"),
          ctaClicksByVariant: readVariantCounts(data, "ctaClicks"),
          hydrated: true,
        });
      },
      () => setState({ ...DEFAULTS, hydrated: true }),
    );
    return () => unsub();
  }, []);

  const trackCta = useCallback(() => {
    void postEvent("ctaClick", variantRef.current);
  }, []);

  return { ...state, trackCta };
}
