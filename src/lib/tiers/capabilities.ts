/**
 * src/lib/tiers/capabilities.ts
 *
 * Single source of truth for what each partner tier can DO on the platform.
 * Pure data + pure functions — safe to import from both client components
 * and server routes (no "server-only", no Firebase).
 *
 * Two capability surfaces today:
 *
 * 1. Client workspaces (white-label resell) — whether a partner at this tier
 *    can create sub-accounts for their own clients, and how many. The
 *    per-partner `maxClientWorkspacesOverride` field on partner_profiles
 *    beats the tier default when set.
 *
 * 2. Tier bundles — which products a tier receives automatically is NOT
 *    defined here; that lives on each product (`Product.includedInTiers`)
 *    so the agency owner manages it from the Product Manager UI. See
 *    src/lib/fulfillment/tier-bundle.ts for the grant pipeline.
 */

import type { PartnerTier, PartnerProfile } from "@/types/partner";

export interface TierCapabilities {
  /** Human label shown in UI. */
  label: string;
  /** Can this tier create client workspaces (white-label sub-accounts)? */
  canCreateClientWorkspaces: boolean;
  /** Default workspace allowance for the tier. 0 when creation is off. */
  maxClientWorkspaces: number;
}

export const TIER_CAPABILITIES: Record<PartnerTier, TierCapabilities> = {
  community: {
    label: "Community",
    canCreateClientWorkspaces: false,
    maxClientWorkspaces: 0,
  },
  operator: {
    label: "Operator",
    canCreateClientWorkspaces: true,
    maxClientWorkspaces: 3,
  },
  certified: {
    label: "Certified",
    canCreateClientWorkspaces: true,
    maxClientWorkspaces: 10,
  },
  elite: {
    label: "Elite",
    canCreateClientWorkspaces: true,
    maxClientWorkspaces: 50,
  },
};

/** Ordered list for tier pickers / checkbox rows. */
export const ALL_TIERS: PartnerTier[] = [
  "community",
  "operator",
  "certified",
  "elite",
];

/**
 * Effective client-workspace allowance for a partner: the per-partner
 * override when set (>= 0), otherwise the tier default. An override > 0 on
 * a tier that normally can't create workspaces DOES enable creation — that
 * is the point of the override (grant one-off exceptions without a tier
 * change).
 */
export function resolveClientWorkspaceLimit(
  profile: Pick<PartnerProfile, "tier" | "maxClientWorkspacesOverride">,
): number {
  const override = profile.maxClientWorkspacesOverride;
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
    return Math.floor(override);
  }
  return TIER_CAPABILITIES[profile.tier]?.maxClientWorkspaces ?? 0;
}

export function canCreateClientWorkspaces(
  profile: Pick<PartnerProfile, "tier" | "maxClientWorkspacesOverride">,
): boolean {
  return resolveClientWorkspaceLimit(profile) > 0;
}
