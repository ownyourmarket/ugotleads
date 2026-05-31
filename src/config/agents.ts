/**
 * Agent registry — static configuration for UGotLeads SOUL-backed agents.
 *
 * Each entry maps to a SOUL.md file in /soul/ that defines the agent's
 * identity, values, expertise, communication style, and operating boundaries.
 *
 * This file is safe to import anywhere in the app (client or server) —
 * it is pure configuration with no external dependencies, no secrets,
 * and no network calls.
 *
 * When adding a new agent:
 *   1. Create /soul/agents/<key>/SOUL.md
 *   2. Add the key to AgentKey in src/types/agents.ts
 *   3. Add the registry entry below
 *   4. Update the routing rules in CLAUDE.md
 */

import type { AgentKey, AgentRegistryEntry } from "@/types/agents";

export const AGENT_REGISTRY: Record<AgentKey, AgentRegistryEntry> = {
  brand: {
    key: "brand",
    label: "Brand",
    description:
      "Core UGotLeads brand identity, voice, values, and positioning. The foundation every other agent builds on.",
    soulPath: "soul/brand/SOUL.md",
    recommendedUse:
      "Always load this first. Every task — code, copy, strategy — should be grounded in the brand SOUL before any specialized agent is applied.",
  },

  "code-engineer": {
    key: "code-engineer",
    label: "Code Engineer",
    description:
      "Senior full-stack engineer for the UGotLeads codebase. Handles implementation, debugging, architecture decisions, and Firestore/Vercel/Stripe integration.",
    soulPath: "soul/agents/code-engineer/SOUL.md",
    recommendedUse:
      "Load for any task involving TypeScript, Next.js, Firebase, API routes, Firestore rules, component changes, or deployment troubleshooting.",
  },

  "marketing-copywriter": {
    key: "marketing-copywriter",
    label: "Marketing Copywriter",
    description:
      "Conversion-focused brand copywriter for UGotLeads and MyUSA. Writes landing pages, emails, offers, and sales sequences in the operator-first voice.",
    soulPath: "soul/agents/marketing-copywriter/SOUL.md",
    recommendedUse:
      "Load for landing page copy, email campaigns, offer framing, headlines, CTAs, and any outbound sales messaging.",
  },

  "compliance-reviewer": {
    key: "compliance-reviewer",
    label: "Compliance Reviewer",
    description:
      "Reviews copy and offers for income claims, franchise-adjacent language, and partner positioning that could create legal or reputational risk.",
    soulPath: "soul/agents/compliance-reviewer/SOUL.md",
    recommendedUse:
      "Load when copy mentions income, commissions, partner success, territory, or any claim that could be read as a guarantee or a business opportunity offer.",
  },

  "customer-onboarding": {
    key: "customer-onboarding",
    label: "Customer Onboarding",
    description:
      "Guided onboarding assistant for new operators and client sub-accounts. Turns signup into first value fast.",
    soulPath: "soul/agents/customer-onboarding/SOUL.md",
    recommendedUse:
      "Load for onboarding flows, setup wizards, operator activation, in-app help content, and first-run user experience work.",
  },

  "founder-operator-advisor": {
    key: "founder-operator-advisor",
    label: "Founder & Operator Advisor",
    description:
      "Strategic operating advisor for Star Riley. Cuts through to the highest-leverage next move on revenue, pricing, and growth.",
    soulPath: "soul/agents/founder-operator-advisor/SOUL.md",
    recommendedUse:
      "Load for business strategy, pricing decisions, launch sequencing, operator network growth, and revenue planning.",
  },
};

/**
 * Ordered list of all registered agent keys.
 * Useful for iteration in UI components and registry lookups.
 */
export const AGENT_KEYS = Object.keys(AGENT_REGISTRY) as AgentKey[];

/**
 * Look up a single agent by key. Returns undefined if the key is not registered.
 */
export function getAgent(key: AgentKey): AgentRegistryEntry {
  return AGENT_REGISTRY[key];
}

/**
 * Returns all registered agents as an array, in definition order.
 */
export function getAllAgents(): AgentRegistryEntry[] {
  return AGENT_KEYS.map((key) => AGENT_REGISTRY[key]);
}
