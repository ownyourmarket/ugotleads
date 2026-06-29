/**
 * ⚠️ VOICE-PORT STUB — placeholder constant.
 *
 * WHAT THIS STUBS:
 *   `GLOBAL_TERRITORY_ID` — in upstream this is exported by the TERRITORIES
 *   feature's type module and represents the sentinel "no specific territory"
 *   bucket. `voice/end-of-call.ts` stamps it onto the campaign follow-up Task
 *   when a contact has no `territoryId`.
 *
 * WHO OWNS THE REAL IMPLEMENTATION:
 *   Upstream's TERRITORIES feature types (re-exported via `@/types`).
 *
 * HOW TO SWAP THE STUB FOR THE REAL THING LATER:
 *   When the territories feature is ported, remove this file and its
 *   re-export line in `src/types/index.ts`; the real `GLOBAL_TERRITORY_ID`
 *   will flow through `@/types` from the territories type module. Confirm the
 *   real value matches (or migrate any Tasks that were stamped "__GLOBAL__").
 *
 * FEATURE DELTA WHILE STUBBED:
 *   Voice campaign follow-up Tasks are stamped with the placeholder
 *   "__GLOBAL__" territory id. Harmless while territories is absent (nothing
 *   reads/filters on it), but distinct from the real sentinel value.
 */
export const GLOBAL_TERRITORY_ID = "__GLOBAL__";
