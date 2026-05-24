"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebaseDb, isFirebaseConfigured } from "@/lib/firebase/client";

export interface FoundersCohortState {
  soldCount: number;
  currentWave: 1 | 2 | 3;
  slotsTotal: number;
  hydrated: boolean;
}

const DEFAULTS: FoundersCohortState = {
  soldCount: 0,
  currentWave: 1,
  slotsTotal: 50,
  hydrated: false,
};

// Manual offset for off-Stripe sales (e.g. Skool, invoiced deals) the
// Stripe webhook can't see. Added on top of the real Stripe count, then
// capped at slotsTotal so we never display more than the cohort cap.
// Bump this env value each time you close a sale outside Stripe.
const MANUAL_SOLD = (() => {
  const raw = process.env.NEXT_PUBLIC_FOUNDERS_MANUAL_SOLD;
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
})();

function applyManualOffset(realFromStripe: number, slotsTotal: number): number {
  return Math.min(realFromStripe + MANUAL_SOLD, slotsTotal);
}

export function useFoundersCohort(): FoundersCohortState {
  const [state, setState] = useState<FoundersCohortState>(DEFAULTS);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setState({
        ...DEFAULTS,
        soldCount: applyManualOffset(0, DEFAULTS.slotsTotal),
        hydrated: true,
      });
      return;
    }

    let db;
    try {
      db = getFirebaseDb();
    } catch {
      setState({
        ...DEFAULTS,
        soldCount: applyManualOffset(0, DEFAULTS.slotsTotal),
        hydrated: true,
      });
      return;
    }

    const ref = doc(db, "appConfig/foundersCohort");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setState({
            ...DEFAULTS,
            soldCount: applyManualOffset(0, DEFAULTS.slotsTotal),
            hydrated: true,
          });
          return;
        }
        const data = snap.data() as Partial<FoundersCohortState>;
        const realSold =
          typeof data.soldCount === "number" ? data.soldCount : 0;
        const slotsTotal =
          typeof data.slotsTotal === "number" ? data.slotsTotal : 50;
        setState({
          soldCount: applyManualOffset(realSold, slotsTotal),
          currentWave:
            data.currentWave === 2 || data.currentWave === 3
              ? data.currentWave
              : 1,
          slotsTotal,
          hydrated: true,
        });
      },
      () =>
        setState({
          ...DEFAULTS,
          soldCount: applyManualOffset(0, DEFAULTS.slotsTotal),
          hydrated: true,
        }),
    );
    return () => unsub();
  }, []);

  return state;
}

export function waveCap(wave: 1 | 2 | 3): number {
  if (wave === 1) return 10;
  if (wave === 2) return 30;
  return 50;
}

export function waveLabel(wave: 1 | 2 | 3): string {
  if (wave === 1) return "True Founders";
  if (wave === 2) return "Early Adopters";
  return "Final Cohort";
}

export function waveBonus(wave: 1 | 2 | 3): string {
  if (wave === 1) return "12 months Gitpage Agency · $1,188 value baked in";
  if (wave === 2) return "6 months Gitpage Agency · $594 value baked in";
  return "3 months Gitpage Agency · $297 value baked in";
}

export function waveGitpageMonths(wave: 1 | 2 | 3): number {
  if (wave === 1) return 12;
  if (wave === 2) return 6;
  return 3;
}

/**
 * Founders pay $891 vs public DIY $1,782 + that wave's Gitpage months at $99/mo.
 * Wave 1: $2,079, Wave 2: $1,485, Wave 3: $1,188.
 */
export function waveSavings(wave: 1 | 2 | 3): number {
  return 1782 - 891 + waveGitpageMonths(wave) * 99;
}
