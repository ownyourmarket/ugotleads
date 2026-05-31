import "server-only";

import fs from "fs/promises";
import path from "path";

import { AGENT_REGISTRY } from "@/config/agents";
import type { AgentKey } from "@/types/agents";

/**
 * The SOUL.md files live at the project root, not inside `src/`.
 * `process.cwd()` resolves to the project root in both local Next.js dev
 * (via Turbopack) and on Vercel, so this is safe for both environments.
 */
const PROJECT_ROOT = process.cwd();

/**
 * Reads a SOUL.md file from disk and returns its trimmed content.
 * Throws a descriptive error if the file is missing — a missing SOUL file
 * is a configuration problem that should surface immediately, not silently
 * produce a broken system prompt.
 */
async function readSoulFile(soulPath: string): Promise<string> {
  const absolutePath = path.join(PROJECT_ROOT, soulPath);

  let content: string;
  try {
    content = await fs.readFile(absolutePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(
        `[soul/prompt-builder] SOUL.md file not found: "${absolutePath}"\n` +
          `Expected path: ${soulPath}\n` +
          `Check that the file exists and the soulPath in AGENT_REGISTRY is correct.`,
      );
    }
    throw new Error(
      `[soul/prompt-builder] Failed to read SOUL.md at "${absolutePath}": ${String(err)}`,
    );
  }

  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error(
      `[soul/prompt-builder] SOUL.md at "${absolutePath}" is empty. ` +
        `Every agent must have a populated SOUL.md before it can be used.`,
    );
  }

  return trimmed;
}

/**
 * Assembles the final system prompt for a SOUL-backed agent by combining:
 *
 *   1. Brand SOUL.md  — core UGotLeads identity, voice, values, and positioning.
 *      Loaded first so it always forms the foundation regardless of the agent key.
 *
 *   2. Agent SOUL.md  — the specialized agent's identity, expertise, workflow,
 *      and operating boundaries. Appended after the brand SOUL so per-agent
 *      instructions can refine (not override) the brand foundation.
 *
 * Section separators use a consistent `---` marker so downstream prompt
 * engineering can split or inspect sections deterministically.
 *
 * Does NOT call OpenRouter. Does NOT write to Firestore. Does NOT accept or
 * expose secrets. Safe to call from any server-side context (API routes,
 * Server Actions, background workers).
 *
 * @param agentKey - One of the keys defined in AgentKey / AGENT_REGISTRY.
 * @returns A single string ready to use as an LLM system prompt.
 *
 * @throws If the agent key is not registered.
 * @throws If either SOUL.md file is missing or empty.
 *
 * @example
 *   const systemPrompt = await buildAgentSystemPrompt("marketing-copywriter");
 *   // Pass systemPrompt as the `system` field in an OpenRouter chat request.
 */
export async function buildAgentSystemPrompt(agentKey: AgentKey): Promise<string> {
  // --- 1. Validate the agent key ------------------------------------------------
  const agent = AGENT_REGISTRY[agentKey];
  if (!agent) {
    // TypeScript's AgentKey union makes this unreachable at compile time for
    // callers with correct types, but worth guarding for runtime safety
    // (e.g. a value arriving from a dynamic route param).
    throw new Error(
      `[soul/prompt-builder] Unknown agent key: "${agentKey}". ` +
        `Valid keys: ${Object.keys(AGENT_REGISTRY).join(", ")}`,
    );
  }

  // --- 2. Read both SOUL files in parallel ---------------------------------------
  const brandSoulPath = AGENT_REGISTRY["brand"].soulPath;
  const [brandSoul, agentSoul] = await Promise.all([
    readSoulFile(brandSoulPath),
    readSoulFile(agent.soulPath),
  ]);

  // --- 3. Assemble the prompt ----------------------------------------------------
  //
  // Structure:
  //   ═══ BRAND SOUL ═══════════════
  //   <brand SOUL.md content>
  //
  //   ---
  //
  //   ═══ AGENT SOUL: <Label> ══════
  //   <agent SOUL.md content>
  //
  // The section headers are uppercase and visually heavy so they're easy to
  // spot in prompt logs. The `---` separator between sections mirrors the
  // Markdown horizontal rule used inside the SOUL files themselves.

  const sections = [
    `═══ BRAND SOUL ═══════════════════════════════════════════════════`,
    brandSoul,
    `---`,
    `═══ AGENT SOUL: ${agent.label.toUpperCase()} ${"═".repeat(Math.max(0, 50 - agent.label.length))}`,
    agentSoul,
  ];

  return sections.join("\n\n");
}
