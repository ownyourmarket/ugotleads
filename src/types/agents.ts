/**
 * Agent registry types.
 *
 * Defines the shape of a SOUL-backed agent entry. Each agent maps to a
 * SOUL.md file under /soul/ that contains its identity, values, expertise,
 * and operating boundaries.
 *
 * This type is deliberately kept small — it is static configuration only.
 * It does not touch OpenRouter, Firebase, or any server-only dependency.
 */

export type AgentKey =
  | "brand"
  | "code-engineer"
  | "marketing-copywriter"
  | "compliance-reviewer"
  | "customer-onboarding"
  | "founder-operator-advisor";

export interface AgentRegistryEntry {
  /** Unique machine-readable key used for routing and lookup. */
  key: AgentKey;

  /** Human-readable display name. */
  label: string;

  /** One-sentence description of what this agent does. */
  description: string;

  /**
   * Path to the agent's SOUL.md file, relative to the project root.
   * Used when an LLM session needs to load the agent's system context.
   */
  soulPath: string;

  /**
   * Plain-English guidance on when to invoke this agent.
   * Mirrors the routing rules in CLAUDE.md so they stay in sync.
   */
  recommendedUse: string;
}
