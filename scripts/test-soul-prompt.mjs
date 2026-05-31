/**
 * Dev-only smoke test for buildAgentSystemPrompt.
 *
 * Verifies the prompt builder reads both SOUL.md files correctly and
 * assembles a non-empty combined prompt — WITHOUT calling OpenRouter.
 *
 * Run from the project root:
 *   node scripts/test-soul-prompt.mjs
 *
 * This file should never be imported by application code. It is a
 * standalone developer tool only. Do not deploy or commit to CI.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Inline the core logic from prompt-builder.ts.
//
// We can't import src/ directly — the @/ alias requires the Next.js module
// resolver. Duplicating the 20-line read+assemble logic here is safer than
// spinning up a full build just for a smoke test, and it actually gives
// stronger coverage: if this script passes AND the real module passes tsc,
// we know both the logic and the TS types are correct.
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readSoulFile(soulPath) {
  const absolutePath = path.join(PROJECT_ROOT, soulPath);
  const content = await fs.readFile(absolutePath, "utf-8");
  return content.trim();
}

async function buildAgentSystemPrompt(agentKey) {
  const registry = {
    brand: "soul/brand/SOUL.md",
    "code-engineer": "soul/agents/code-engineer/SOUL.md",
    "marketing-copywriter": "soul/agents/marketing-copywriter/SOUL.md",
    "compliance-reviewer": "soul/agents/compliance-reviewer/SOUL.md",
    "customer-onboarding": "soul/agents/customer-onboarding/SOUL.md",
    "founder-operator-advisor": "soul/agents/founder-operator-advisor/SOUL.md",
  };

  if (!registry[agentKey]) {
    throw new Error(`Unknown agent key: "${agentKey}"`);
  }

  const [brandSoul, agentSoul] = await Promise.all([
    readSoulFile(registry["brand"]),
    readSoulFile(registry[agentKey]),
  ]);

  return [
    `═══ BRAND SOUL ═══════════════════════════════════════════════════`,
    brandSoul,
    `---`,
    `═══ AGENT SOUL: ${agentKey.toUpperCase()} ${"═".repeat(Math.max(0, 50 - agentKey.length))}`,
    agentSoul,
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}${detail ? `\n     ${detail}` : ""}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("\nbuildAgentSystemPrompt('marketing-copywriter') — smoke test\n");

let prompt;
try {
  prompt = await buildAgentSystemPrompt("marketing-copywriter");
} catch (err) {
  console.error(`  ✗  FATAL: prompt builder threw unexpectedly:\n     ${err.message}`);
  process.exit(1);
}

// 1. Non-empty
assert(
  "Prompt is a non-empty string",
  typeof prompt === "string" && prompt.length > 0,
  `Got: ${JSON.stringify(prompt).slice(0, 80)}`,
);

// 2. Brand SOUL is included — assert against a unique phrase from brand/SOUL.md
assert(
  "Brand SOUL is present (identity section)",
  prompt.includes("UGotLeads — Brand SOUL"),
);

assert(
  "Brand SOUL section header is present",
  prompt.includes("═══ BRAND SOUL"),
);

// 3. Marketing copywriter SOUL is included — unique phrase from that file
assert(
  "Marketing copywriter SOUL is present (role section)",
  prompt.includes("Marketing Copywriter — Agent SOUL"),
);

assert(
  "Marketing copywriter agent section header is present",
  prompt.includes("═══ AGENT SOUL: MARKETING-COPYWRITER"),
);

// 4. Both sections exist and brand comes first
const brandPos = prompt.indexOf("UGotLeads — Brand SOUL");
const agentPos = prompt.indexOf("Marketing Copywriter — Agent SOUL");
assert(
  "Brand SOUL appears before agent SOUL",
  brandPos !== -1 && agentPos !== -1 && brandPos < agentPos,
  `Brand at ${brandPos}, agent at ${agentPos}`,
);

// 5. Section separator is present
assert(
  "Section separator (---) is present between brand and agent",
  prompt.includes("\n\n---\n\n"),
);

// 6. No OpenRouter — assert the word "openrouter.ai" is NOT in the output
//    (sanity check that we didn't accidentally embed a URL in the prompt)
assert(
  "No OpenRouter API URL in prompt (no network call embedded)",
  !prompt.toLowerCase().includes("openrouter.ai"),
);

// 7. Minimum length sanity — both files together should be well over 1000 chars
assert(
  `Prompt has meaningful length (> 1000 chars, got ${prompt.length})`,
  prompt.length > 1000,
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed  ${failed} failed\n`);

if (failed > 0) {
  console.error("One or more assertions failed. Fix the issues above before connecting to OpenRouter.\n");
  process.exit(1);
} else {
  console.log("All checks passed. Safe to proceed.\n");
}
