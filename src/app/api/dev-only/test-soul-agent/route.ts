import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { AGENT_KEYS } from "@/config/agents";
import { runSoulAgent } from "@/lib/soul/agent-runner";
import type { AgentKey } from "@/types/agents";

/**
 * DEV-ONLY — SOUL agent smoke test endpoint.
 *
 * Calls runSoulAgent with a user-supplied agentKey + message and returns
 * the assistant reply with token metadata. Useful for verifying that a
 * SOUL.md edit produces the expected model behaviour without building UI.
 *
 * Guards (all must pass):
 *   1. NODE_ENV !== "production"  → 403 if production
 *   2. Valid JSON body            → 400 if malformed
 *   3. agentKey in AGENT_KEYS    → 400 if unknown
 *   4. userMessage non-empty     → 400 if missing
 *
 * POST /api/dev-only/test-soul-agent
 * Body: { agentKey, userMessage, context?, model? }
 *
 * Example (from project root):
 *   curl -s -X POST http://localhost:3000/api/dev-only/test-soul-agent \
 *     -H "Content-Type: application/json" \
 *     -d '{"agentKey":"marketing-copywriter","userMessage":"Write a one-line headline for UGotLeads."}' \
 *     | jq .
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // --- Guard 1: production block ----------------------------------------------
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "This endpoint is not available in production." },
      { status: 403 },
    );
  }

  // --- Guard 2: parse body ----------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Body must be a JSON object." },
      { status: 400 },
    );
  }

  const { agentKey, userMessage, context, model } = body as Record<string, unknown>;

  // --- Guard 3: agentKey ------------------------------------------------------
  if (typeof agentKey !== "string" || !agentKey.trim()) {
    return NextResponse.json(
      {
        error: "agentKey is required.",
        validKeys: AGENT_KEYS,
      },
      { status: 400 },
    );
  }

  if (!(AGENT_KEYS as string[]).includes(agentKey)) {
    return NextResponse.json(
      {
        error: `Unknown agentKey: "${agentKey}".`,
        validKeys: AGENT_KEYS,
      },
      { status: 400 },
    );
  }

  // --- Guard 4: userMessage ---------------------------------------------------
  if (typeof userMessage !== "string" || !userMessage.trim()) {
    return NextResponse.json(
      { error: "userMessage is required and must be a non-empty string." },
      { status: 400 },
    );
  }

  if (typeof context !== "undefined" && typeof context !== "string") {
    return NextResponse.json(
      { error: "context must be a string when provided." },
      { status: 400 },
    );
  }

  if (typeof model !== "undefined" && typeof model !== "string") {
    return NextResponse.json(
      { error: "model must be a string when provided." },
      { status: 400 },
    );
  }

  // --- Run the agent ----------------------------------------------------------
  try {
    const result = await runSoulAgent({
      agentKey: agentKey as AgentKey,
      userMessage: userMessage.trim(),
      context: typeof context === "string" ? context : undefined,
      model: typeof model === "string" ? model : undefined,
    });

    return NextResponse.json({
      agentKey: result.agentKey,
      agentLabel: result.agentLabel,
      model: result.model,
      text: result.text,
      usage: {
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Surface the specific error category so callers know whether the problem
    // is configuration (missing key, missing SOUL file) or the provider.
    const isMissingKey = message.includes("OPENROUTER_API_KEY");
    const isMissingSoul = message.includes("SOUL.md file not found");
    const isProviderError = message.includes("OpenRouter");

    return NextResponse.json(
      {
        error: message,
        hint: isMissingKey
          ? "Add OPENROUTER_API_KEY to .env.local and restart the dev server."
          : isMissingSoul
            ? "A SOUL.md file is missing. Run pnpm test:soul to identify which one."
            : isProviderError
              ? "OpenRouter returned an error. Check your API key and model name."
              : "Unexpected error. See server logs for the full trace.",
      },
      { status: 500 },
    );
  }
}
