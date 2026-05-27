/**
 * Hero copy variants for the UGotLeads-branded landing's A/B/C test.
 *
 * Each new visitor is randomly assigned ONE variant (cookie-pinned, 90-day
 * window) so they see the same framing across visits. CTA clicks bucket by
 * variant so conversion rate per framing can be measured honestly.
 *
 * Universal — no "server-only" guard because both the server cookie reader
 * and the client Hero component import this.
 */

export type HeroVariantId = "A" | "B" | "C";

export const HERO_VARIANT_IDS: HeroVariantId[] = ["A", "B", "C"];

/** Cookie name pinning each visitor to one variant. */
export const HERO_VARIANT_COOKIE = "ls_hero_variant";

/** 90 days — long enough that a visitor researching for weeks gets one
 *  consistent message, short enough that a long-tail return after losing
 *  interest gets a fresh roll. */
export const HERO_VARIANT_COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export interface HeroVariantCopy {
  id: HeroVariantId;
  label: string;
  headlinePre: string;
  /** Rendered in the gradient italic serif. Sits inline after `headlinePre`. */
  headlineGradient: string;
  /** Optional suffix after the gradient phrase. Empty string = nothing. */
  headlinePost: string;
  subhead: string;
}

export const HERO_VARIANTS: Record<HeroVariantId, HeroVariantCopy> = {
  A: {
    id: "A",
    label: "GHL contrast",
    headlinePre: "GoHighLevel charges $297/month forever.",
    headlineGradient: "UGotLeads is $891 once.",
    headlinePost: "",
    subhead:
      "Same multi-tenant CRM, same instant-response automations, same built-in website builder — but you own the source code and never pay rent. Spin up your first client workspace in 60 minutes.",
  },
  B: {
    id: "B",
    label: "Outcome-first",
    headlinePre: "Run unlimited client workspaces",
    headlineGradient: "without renting",
    headlinePost: "the platform forever.",
    subhead:
      "Onboard a new agency client in 60 minutes. Their leads in, automations firing, website live — all from one license you pay for once. No per-contact tier, no per-message tax, no SaaS landlord.",
  },
  C: {
    id: "C",
    label: "Authority + scarcity",
    headlinePre: "The CRM agencies",
    headlineGradient: "actually own.",
    headlinePost: "",
    subhead:
      "Multi-tenant workspaces, automations, and a website builder in one license. You get the source code, run unlimited clients, never pay monthly. Stop renting the platform that holds your customers hostage.",
  },
};

export function isHeroVariantId(value: unknown): value is HeroVariantId {
  return (
    typeof value === "string" &&
    HERO_VARIANT_IDS.includes(value as HeroVariantId)
  );
}

/**
 * Picks a variant uniformly at random. Math.random is sufficient — perfect
 * uniformity isn't required for A/B/C testing at our scale.
 */
export function randomHeroVariant(): HeroVariantId {
  const i = Math.floor(Math.random() * HERO_VARIANT_IDS.length);
  return HERO_VARIANT_IDS[i] ?? "A";
}
