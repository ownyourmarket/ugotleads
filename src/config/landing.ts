/**
 * Landing-page configuration.
 *
 * The repo ships with two complete landing pages:
 *
 *   - "custom"    — a generic agency-CRM landing the buyer brands as
 *     their own. THIS IS THE DEFAULT — every new clone should be
 *     branded for the buyer's business, so the custom variant renders
 *     at "/" out of the box and CUSTOM_BRAND below should be edited
 *     first.
 *
 *     Wired for a DONE-FOR-YOU sales motion, not self-serve SaaS:
 *     prospects see a "Talk to us" mailto CTA (uses CUSTOM_BRAND.
 *     supportEmail), the owner takes payment off-system, provisions
 *     a sub-account, then invites the client via the in-app invite
 *     flow. Pricing tiers + section are hidden by default — see the
 *     CUSTOM_BRAND.pricing block below for how to re-enable real
 *     self-serve resale.
 *
 *   - "leadstack" — the UGotLeads-branded marketing landing that sells
 *     UGotLeads itself (used on the ugotleads.io demo site). Only flip
 *     back to this if you're running the public UGotLeads demo.
 *
 * Flip LANDING_VARIANT below to swap which one renders at "/".
 */

export type LandingVariant = "leadstack" | "custom";

export const LANDING_VARIANT: LandingVariant = "custom";

export interface CustomPricingTier {
  name: string;
  priceMonthly: number;
  priceAnnual: number;
  blurb: string;
  features: readonly string[];
  cta: string;
  highlighted: boolean;
}

export interface CustomBrand {
  name: string;
  tagline: string;
  shortDescription: string;
  supportEmail: string;
  primaryDomain: string;
  pricing: {
    starter: CustomPricingTier;
    pro: CustomPricingTier;
    scale: CustomPricingTier;
  };
}

/**
 * The brand object actually passed to the custom landing components at
 * render time. Resolved on the server by lib/landing/resolve-brand.ts —
 * agency doc fields take precedence, CUSTOM_BRAND fills the gaps. `logoUrl`
 * is nullable because "no logo set" is a meaningful state (renders the
 * default gradient mark instead of an <img>).
 */
export interface ResolvedBrand {
  name: string;
  logoUrl: string | null;
  tagline: string;
  shortDescription: string;
  supportEmail: string;
  primaryDomain: string;
}

/**
 * Brand fields used by the "custom" landing variant. Ignored entirely when
 * LANDING_VARIANT is "leadstack". Edit these to brand the white-label
 * landing for your own business — the values below are placeholder
 * defaults so the page renders cleanly out of the box.
 */
export const CUSTOM_BRAND: CustomBrand = {
  /** Displayed in navbar, hero, footer copyright, page title — everywhere. */
  name: "UGotLeads",

  /** One-line positioning, surfaced in hero subtitle + meta description. */
  tagline: "The done-for-you growth CRM for local business operators",

  /**
   * Short (~140 char) description used under the hero headline. Should
   * read like a tweet — what the product does, for whom.
   */
  shortDescription:
    "Lead capture, pipeline, AI follow-up, and your own branded marketing sites — built and run for you, so you focus on closing deals.",

  /** Used on CTA buttons + the FAQ "talk to us" line + footer. */
  supportEmail: "myusalocal@gmail.com",

  /** Used in footer, og:url, canonical. No https://, no trailing slash. */
  primaryDomain: "ugotleads.io",

  /**
   * Pricing tiers. HIDDEN BY DEFAULT — the custom landing is wired for
   * done-for-you sales (see header comment), not self-serve, so the
   * Pricing section and the #pricing nav link are not rendered. The
   * config below is kept as a starting point for buyers who later want
   * to enable real Stripe-driven SaaS resale. To re-enable:
   *
   *   1. In src/app/page.tsx, re-import and render <CustomPricing />
   *      (file at src/components/landing-custom/pricing.tsx).
   *   2. Re-add the "#pricing" nav link in landing-custom/navbar.tsx
   *      (desktop nav + mobile sheet).
   *   3. Wire the pricing card buttons to createCheckoutSession with
   *      the relevant STRIPE_PRO_PRICE_ID etc., instead of /signup.
   *   4. Un-gate the Subscription panel in the sub-account settings
   *      page (currently gated on LANDING_VARIANT === "leadstack").
   *   5. Add a Stripe-driven public signup flow that provisions a
   *      fresh agency + sub-account + owner membership on
   *      checkout.completed — today's /api/auth/signup is invite-only
   *      after the first bootstrap user, so strangers paying through
   *      Stripe can't currently land anywhere. See CLAUDE.md
   *      ("Auth & Tenancy Model") for the existing signup contract.
   */
  pricing: {
    starter: {
      name: "Local Pro",
      priceMonthly: 197,
      priceAnnual: 1970,
      blurb: "Your own AI-powered CRM for one local business.",
      features: [
        "Your own branded UGotLeads sub-account",
        "Unlimited contacts + 6-stage pipeline",
        "Web Chat AI agent on your site",
        "SMS auto-reply + automated follow-up",
        "Built-in marketing site builder (GitPage)",
        "Speed-to-Lead automation recipes",
        "Up to 3 team seats",
      ],
      cta: "Talk to us",
      highlighted: false,
    },
    pro: {
      name: "Multi-Service Operator",
      priceMonthly: 297,
      priceAnnual: 2970,
      blurb: "For operators running multiple service lines or locations.",
      features: [
        "Everything in Local Pro",
        "Up to 3 sub-pipelines (HVAC + plumbing + roofing, etc.)",
        "AI-generated 30-day social content monthly",
        "Lead scraping from Google Maps + Yelp + BBB",
        "Reputation/review request flow",
        "Google Business Profile auto-posting",
        "Unlimited team seats",
      ],
      cta: "Talk to us",
      highlighted: true,
    },
    scale: {
      name: "Territory Partner",
      priceMonthly: 497,
      priceAnnual: 4970,
      blurb: "For MyUSA-licensed operators running a local market.",
      features: [
        "Everything in Multi-Service Operator",
        "Unlimited client sub-accounts",
        "MyUSA territory licensee access",
        "Performance-based affiliate commissions",
        "Cross-client analytics dashboard",
        "Quarterly strategy sessions",
        "Priority support + dedicated onboarding",
      ],
      cta: "Talk to us",
      highlighted: false,
    },
  },
};
