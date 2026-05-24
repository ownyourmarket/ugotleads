import "server-only";

import { cookies } from "next/headers";
import {
  HERO_VARIANT_COOKIE,
  isHeroVariantId,
  randomHeroVariant,
  type HeroVariantId,
} from "@/lib/hero-variants";

/**
 * Server-side variant resolution for the landing page. Returns the
 * cookie-pinned variant if the visitor already has one; otherwise picks a
 * fresh random variant.
 *
 * NOTE: Next.js server components can READ cookies but can't SET them
 * during render. The fresh pick returned here is written to the client
 * cookie via a small useEffect in the Hero component on first render, so
 * subsequent visits see a stable assignment. There's a small window where
 * a tab-close-and-reopen before the client hydrates could re-roll — at our
 * scale that's negligible noise compared to the value of stable buckets.
 */
export async function resolveHeroVariant(): Promise<HeroVariantId> {
  const store = await cookies();
  const existing = store.get(HERO_VARIANT_COOKIE)?.value;
  if (isHeroVariantId(existing)) {
    return existing;
  }
  return randomHeroVariant();
}
