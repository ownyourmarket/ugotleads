import "server-only";

import {
  callAi,
  aiIsConfigured,
  defaultAiModel,
  type AiCompletionResult,
} from "@/lib/comms/ai/openrouter";
import { buildAgentSystemPrompt } from "@/lib/soul/prompt-builder";
import { AGENT_REGISTRY } from "@/config/agents";
import type { AgentKey } from "@/types/agents";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunAgentInput {
  /** Which SOUL-backed agent to use. Determines system prompt. */
  agentKey: AgentKey;

  /** The user's message or task description. */
  userMessage: string;

  /**
   * Optional extra context injected between the system prompt and user
   * message. Use this to pass structured data the agent needs to act on
   * (e.g. a draft email, a contact record, a sales page excerpt).
   *
   * Kept separate from userMessage so the agent always sees a clean
   * user→assistant turn structure with context in the right position.
   */
  context?: string;

  /**
   * OpenRouter model override. Defaults to the deployment-wide default
   * (AI_REPLIES_DEFAULT_MODEL env var → claude-haiku-4.5 fallback).
   * Pass "anthropic/claude-sonnet-4-5" or "anthropic/claude-opus-4-5"
   * for higher-quality tasks that need it.
   */
  model?: string;

  /**
   * Max output tokens. Defaults to 1200 — enough for a detailed paragraph
   * or a short structured response. Increase for long-form tasks (e.g. a
   * full email sequence), decrease for one-liners (e.g. a headline).
   */
  maxTokens?: number;

  /** Sampling temperature. Defaults to 0.6 — balanced creativity/accuracy. */
  temperature?: number;
}

export interface RunAgentResult extends AiCompletionResult {
  /** Echo back which agent was used, for logging and UI display. */
  agentKey: AgentKey;
  /** Echo back the agent label for display convenience. */
  agentLabel: string;
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

/**
 * Runs a SOUL-backed AI agent against a user message.
 *
 * Combines:
 *   1. The brand SOUL.md + the selected agent's SOUL.md → system prompt
 *   2. Optional context block → injected as a system turn before the user message
 *   3. The user's message → user turn
 *
 * Then calls OpenRouter via the existing `callAi` client and returns the
 * full result including token usage.
 *
 * Does NOT write to Firestore. Does NOT modify any existing AI flow.
 * Entirely additive — the existing SMS/web-chat AI pipeline is unchanged.
 *
 * @throws If the agent key is not registered in AGENT_REGISTRY.
 * @throws If OPENROUTER_API_KEY is not set.
 * @throws If the SOUL.md file for either brand or the selected agent is missing.
 * @throws If OpenRouter returns a non-2xx response or empty content.
 *
 * @example
 *   const result = await runSoulAgent({
 *     agentKey: "marketing-copywriter",
 *     userMessage: "Rewrite this headline to be more operator-focused.",
 *     context: "Current headline: 'AI-powered CRM for everyone'",
 *   });
 *   console.log(result.text);
 */
export async function runSoulAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const { agentKey, userMessage, context, model, maxTokens = 1200, temperature = 0.6 } = input;

  // --- 1. Guard: agent key must exist ----------------------------------------
  const agentEntry = AGENT_REGISTRY[agentKey];
  if (!agentEntry) {
    throw new Error(
      `[soul/agent-runner] Unknown agent key: "${agentKey}". ` +
        `Valid keys: ${Object.keys(AGENT_REGISTRY).join(", ")}`,
    );
  }

  // --- 2. Guard: OpenRouter must be configured --------------------------------
  if (!aiIsConfigured()) {
    throw new Error(
      `[soul/agent-runner] OPENROUTER_API_KEY is not set. ` +
        `Add it to .env.local (local) or Vercel environment variables (production) ` +
        `before calling runSoulAgent.`,
    );
  }

  // --- 3. Build system prompt from SOUL.md files ------------------------------
  //
  // This reads two markdown files from disk (soul/brand/SOUL.md +
  // soul/agents/<key>/SOUL.md) and assembles them with section separators.
  // Throws a descriptive error if either file is missing.
  const systemPrompt = await buildAgentSystemPrompt(agentKey);

  // --- 4. Assemble the message array ------------------------------------------
  //
  // Message structure:
  //   system   → SOUL system prompt (brand + agent identity)
  //   system   → context block (optional; structured data for the agent to act on)
  //   user     → the actual user message / task
  //
  // Using a second "system" turn for context rather than prepending it to the
  // user message keeps the user turn clean and lets the model distinguish
  // "here is the context I'm working with" from "here is what I'm asking".
  // OpenRouter / Claude handle multiple system turns correctly.

  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  if (context?.trim()) {
    messages.push({
      role: "system",
      content: `--- CONTEXT ---\n\n${context.trim()}`,
    });
  }

  messages.push({ role: "user", content: userMessage.trim() });

  // --- 5. Call OpenRouter -----------------------------------------------------
  const chosenModel = model?.trim() || defaultAiModel();

  let result: AiCompletionResult;
  try {
    result = await callAi({ model: chosenModel, messages, maxTokens, temperature });
  } catch (err) {
    // Re-throw with agent context so callers and logs can identify which
    // agent failed without having to decode the raw OpenRouter error alone.
    throw new Error(
      `[soul/agent-runner] OpenRouter call failed for agent "${agentKey}" (${agentEntry.label}): ` +
        String(err),
    );
  }

  // --- 6. Return with agent metadata appended ---------------------------------
  return {
    ...result,
    agentKey,
    agentLabel: agentEntry.label,
  };
}
