/**
 * Shared shape + defaults for the live-editable deal campaign — the deal
 * name, the scarcity-counter noun ("spots"), and the seat count shown across
 * every landing surface (hero, pricing card, announcement bar, CTAs, FAQ).
 *
 * Persisted on the EXISTING `appConfig/foundersCohort` doc (fields `dealName`,
 * `memberNoun`, `slotsTotal`) — the same publicly-readable doc the scarcity
 * counter already reads live via {@link useFoundersCohort}, so no new
 * Firestore rules are needed. Server-only writes via
 * /api/agency/deal-config (Admin SDK). Code defaults come from
 * `src/config/deal.ts`; the doc overrides them the moment the agency owner
 * saves once. Mirrors the updates-modal config feature.
 *
 * Deliberately NOT here: soldCount / currentWave (Stripe-webhook-owned — the
 * editor never writes them) and prices (kept inline in components by design;
 * see src/config/deal.ts).
 */

import { DEAL } from "@/config/deal";

export interface DealConfig {
  /** Campaign name — headlines, badges, pricing-card title, FAQ. */
  dealName: string;
  /** Plural noun in the scarcity counter: "{sold} of {total} {noun} claimed". */
  memberNoun: string;
  /** Cohort size — the live override of DEAL.seatsTotal. */
  slotsTotal: number;
}

/** Hard caps so an untrusted payload can't bloat the doc or break layouts. */
export const DEAL_NAME_MAX = 60;
export const DEAL_MEMBER_NOUN_MAX = 24;
export const DEAL_SEATS_MIN = 1;
export const DEAL_SEATS_MAX = 10000;

/** Shown until the agency owner saves once (or the doc/fields are missing). */
export const DEAL_CONFIG_DEFAULTS: DealConfig = {
  dealName: DEAL.name,
  memberNoun: DEAL.memberNoun,
  slotsTotal: DEAL.seatsTotal,
};

/** Normalize an untrusted Firestore payload to a complete, valid config. */
export function coerceDealConfig(
  data: Record<string, unknown> | undefined | null,
): DealConfig {
  if (!data) return { ...DEAL_CONFIG_DEFAULTS };

  const dealName =
    typeof data.dealName === "string" && data.dealName.trim()
      ? data.dealName.trim().slice(0, DEAL_NAME_MAX)
      : DEAL_CONFIG_DEFAULTS.dealName;

  const memberNoun =
    typeof data.memberNoun === "string" && data.memberNoun.trim()
      ? data.memberNoun.trim().slice(0, DEAL_MEMBER_NOUN_MAX)
      : DEAL_CONFIG_DEFAULTS.memberNoun;

  const rawSlots = data.slotsTotal;
  const slotsTotal =
    typeof rawSlots === "number" &&
    Number.isInteger(rawSlots) &&
    rawSlots >= DEAL_SEATS_MIN &&
    rawSlots <= DEAL_SEATS_MAX
      ? rawSlots
      : DEAL_CONFIG_DEFAULTS.slotsTotal;

  return { dealName, memberNoun, slotsTotal };
}
