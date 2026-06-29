import "server-only";

/**
 * ⚠️ VOICE-PORT STUB — NOT THE REAL IMPLEMENTATION.
 *
 * WHAT THIS STUBS:
 *   `loadEffectiveTerritoryScope()` — in upstream this resolves whether the
 *   calling user's audience queries must be restricted to their assigned
 *   territories (collaborators in a territory-scoped sub-account) vs.
 *   unrestricted (admins / agency owners).
 *
 * WHO OWNS THE REAL IMPLEMENTATION:
 *   Upstream's TERRITORIES feature (`src/lib/auth/territory-filter.ts`, 116
 *   lines, 2 internal deps) plus the `territories` Firestore collection +
 *   rules + management routes. NONE of that exists on this repo yet —
 *   territories was scoped OUT of the voice port.
 *
 * HOW TO SWAP THE STUB FOR THE REAL THING LATER:
 *   Port the upstream territories feature (this module + its deps + the
 *   `territories` collection + rules + routes), then delete this file.
 *
 * 🔐 SECURITY NOTE — CONFIRM ACCEPTABLE FOR V1 VOICE SHIP:
 *   This stub returns `enforce:false`, meaning OUTBOUND voice campaigns are
 *   NOT territory-scoped. A collaborator launching a campaign would reach the
 *   FULL sub-account audience, not just their assigned territory. This is the
 *   same effective behavior as a sub-account with territory scoping disabled.
 *   It is SAFE for any deployment that does not use territory-scoped
 *   collaborators. If you DO rely on territory isolation between
 *   collaborators, do NOT enable outbound voice campaigns for collaborators
 *   until the real territories feature is ported.
 *
 * FEATURE DELTA WHILE STUBBED:
 *   `voice/campaign/send` audience resolution applies no territory filter.
 */

export interface EffectiveTerritoryScope {
  /** Always false while stubbed → never restrict the audience. */
  enforce: boolean;
  /** Always null while stubbed. */
  ids: string[] | null;
}

export async function loadEffectiveTerritoryScope(
  access: unknown,
): Promise<EffectiveTerritoryScope> {
  void access;
  console.info(
    "[voice-stub] territory scope stubbed — audience UNFILTERED (enforce:false)",
  );
  return { enforce: false, ids: null };
}
