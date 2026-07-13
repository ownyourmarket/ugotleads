/**
 * Current sales campaign — the CODE DEFAULTS for the deal's name, member
 * noun, and seat count.
 *
 * ⚠️ These are DEFAULTS only. The live values are edited in-app at
 * /agency/landing → the "Deal" card, which writes `dealName`, `memberNoun`,
 * and `slotsTotal` onto the `appConfig/foundersCohort` Firestore doc — every
 * landing surface (hero, pricing card, announcement bar, CTAs, FAQ, scarcity
 * counter) reads that doc live via useFoundersCohort, no deploy needed.
 * The values below only show until the doc has those fields (fresh clone /
 * Firebase unconfigured).
 *
 * Intentionally NOT editable in-app (kept inline in the components by design):
 *   - prices ($891 / $1,782) — change those in the pricing copy directly, so
 *     the displayed price can't drift from the Stripe price actually charged.
 *   - inclusion bullets on the pricing card.
 *
 * The INTERNAL plumbing keeps the legacy "founders" name on purpose
 * (route /api/checkout/founders, the use-founders-* hooks, the
 * STRIPE_FOUNDERS_PRICE_ID env var, the appConfig/foundersCohort Firestore
 * doc, and the Stripe `kind: "founders"` metadata). Those are invisible to
 * buyers and renaming them would break reconciliation of existing purchases.
 *
 * Starting a fresh campaign: change name/noun/seats in the Deal card, then
 * reset `soldCount` (and `currentWave` if used) on appConfig/foundersCohort
 * in the Firebase console — the editor deliberately never touches those.
 */
export const DEAL = {
  /** Campaign name — headlines, badges, pricing-card title, FAQ. */
  name: "The New Era Deal",

  /** Plural noun in the scarcity counter: "{sold} of {total} {memberNoun} claimed". */
  memberNoun: "spots",

  /** Cohort size (code default; see the Firestore override note above). */
  seatsTotal: 25,
} as const;
