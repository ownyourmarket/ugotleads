import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";
import { runSoulAgent } from "@/lib/soul/agent-runner";
import type { AgentKey } from "@/types/agents";
import type { MemberStatus, Role } from "@/types";

/**
 * Agency-owner AI agent runner.
 *
 * POST /api/agency/agents
 * Body: { agentKey, userMessage, context? }
 *
 * Backs the /agency/marketing-copy and /agency/compliance workbench pages.
 * Only the two owner-facing agents are exposed here — internal agents
 * (code-engineer, brand, etc.) stay server-side only. The model is chosen
 * server-side (deployment default) so clients cannot select expensive
 * models or inflate token limits.
 */

// LLM completions regularly exceed the default function window.
export const maxDuration = 60;

const EXPOSED_AGENT_KEYS = ["marketing-copywriter", "compliance-reviewer"] as const;
type ExposedAgentKey = (typeof EXPOSED_AGENT_KEYS)[number];

const MAX_MESSAGE_CHARS = 4000;
const MAX_CONTEXT_CHARS = 8000;

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyRole?: "owner" | "staff" | null;
  agencyId?: string | null;
}

async function requireAgencyOwner(request: Request): Promise<
  { uid: string; agencyId: string } | NextResponse
> {
  const uid = request.headers.get("x-user-uid");
  if (!uid) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const record = await getAdminAuth().getUser(uid).catch(() => null);
  if (!record) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const claims = (record.customClaims ?? {}) as CallerClaims;
  if (claims.status !== "active") {
    return NextResponse.json({ error: "Account inactive" }, { status: 403 });
  }
  if (claims.agencyRole !== "owner" || !claims.agencyId) {
    return NextResponse.json(
      { error: "Only the agency owner can use agency agents." },
      { status: 403 },
    );
  }
  return { uid, agencyId: claims.agencyId };
}

export async function POST(request: Request) {
  const access = await requireAgencyOwner(request);
  if (access instanceof NextResponse) return access;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Body must be a JSON object." },
      { status: 400 },
    );
  }

  const { agentKey, userMessage, context } = body as Record<string, unknown>;

  if (
    typeof agentKey !== "string" ||
    !(EXPOSED_AGENT_KEYS as readonly string[]).includes(agentKey)
  ) {
    return NextResponse.json(
      { error: "agentKey must be one of: " + EXPOSED_AGENT_KEYS.join(", ") },
      { status: 400 },
    );
  }

  if (typeof userMessage !== "string" || !userMessage.trim()) {
    return NextResponse.json(
      { error: "userMessage is required." },
      { status: 400 },
    );
  }
  if (userMessage.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `userMessage must be ${MAX_MESSAGE_CHARS} characters or fewer.` },
      { status: 400 },
    );
  }

  if (typeof context !== "undefined" && typeof context !== "string") {
    return NextResponse.json(
      { error: "context must be a string when provided." },
      { status: 400 },
    );
  }
  if (typeof context === "string" && context.length > MAX_CONTEXT_CHARS) {
    return NextResponse.json(
      { error: `context must be ${MAX_CONTEXT_CHARS} characters or fewer.` },
      { status: 400 },
    );
  }

  try {
    const result = await runSoulAgent({
      agentKey: agentKey as ExposedAgentKey satisfies AgentKey,
      userMessage: userMessage.trim(),
      context: typeof context === "string" && context.trim() ? context : undefined,
      maxTokens: 1600,
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

    if (message.includes("OPENROUTER_API_KEY")) {
      return NextResponse.json(
        { error: "AI is not configured on this deployment. Contact support." },
        { status: 503 },
      );
    }

    console.error(
      `[api/agency/agents] agent run failed (agency ${access.agencyId}):`,
      err,
    );
    return NextResponse.json(
      { error: "The agent could not complete this request. Try again." },
      { status: 500 },
    );
  }
}
