import { NextResponse } from "next/server";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import {
  getAgentProfile,
  getChannelConfig,
  upsertChannelConfig,
  type ConfiguredChannelId,
} from "@/lib/comms/ai/agent";
import type { AiChannelConfig, WebChatChannelConfig } from "@/types/ai";
import { DEFAULT_WEB_CHAT_CONFIG } from "@/types/ai";

export const dynamic = "force-dynamic";

const VALID_CHANNELS: ConfiguredChannelId[] = ["sms", "web-chat"];

function isValidChannel(v: string): v is ConfiguredChannelId {
  return (VALID_CHANNELS as string[]).includes(v);
}

/** Strip a domain string down to bare hostname. Accepts URLs with scheme
 *  or bare hostnames. Returns null for anything that doesn't look like a
 *  domain so the operator's typos don't poison the allowlist silently. */
function normaliseDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("://")) {
    try {
      s = new URL(s).hostname;
    } catch {
      return null;
    }
  } else {
    s = s.replace(/^https?:\/\//, "").split("/")[0]!.split(":")[0]!;
  }
  // Permissive: a hostname has a dot (example.com) OR is "localhost".
  if (!s.includes(".") && s !== "localhost") return null;
  if (!/^[a-z0-9.-]+$/.test(s)) return null;
  return s;
}

function sanitiseWebChatBlock(raw: unknown): Partial<WebChatChannelConfig> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<WebChatChannelConfig> = {};

  if ("allowedDomains" in r && Array.isArray(r.allowedDomains)) {
    out.allowedDomains = (r.allowedDomains as unknown[])
      .filter((v): v is string => typeof v === "string")
      .map(normaliseDomain)
      .filter((s): s is string => !!s)
      .slice(0, 25);
  }
  if ("welcomeMessage" in r && typeof r.welcomeMessage === "string") {
    out.welcomeMessage = r.welcomeMessage.slice(0, 400);
  }
  if ("accentColor" in r && typeof r.accentColor === "string") {
    const v = r.accentColor.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) out.accentColor = v.toLowerCase();
  }
  if (
    "position" in r &&
    (r.position === "right" || r.position === "left")
  ) {
    out.position = r.position;
  }

  return out;
}

/**
 * Per-channel AI Agent operational config (enabled toggle, model, context
 * size, optional escalation overrides). One doc per channel. Admin-only.
 *
 * The shared persona lives on the profile (see ai-agent/profile/route.ts).
 * Refusing to enable a channel without a profile prompt is the safety
 * rail — we don't want a bot replying with an empty persona.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string; channel: string }> },
) {
  const { id, channel } = await ctx.params;
  if (!isValidChannel(channel)) {
    return NextResponse.json({ error: "Unknown channel" }, { status: 404 });
  }
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  const config = await getChannelConfig(id, channel);
  return NextResponse.json({ config });
}

function sanitisePatch(
  input: Record<string, unknown>,
): Partial<AiChannelConfig> {
  const patch: Partial<AiChannelConfig> = {};

  if ("enabled" in input && typeof input.enabled === "boolean") {
    patch.enabled = input.enabled;
  }
  if (
    "contextMessageCount" in input &&
    typeof input.contextMessageCount === "number"
  ) {
    patch.contextMessageCount = Math.max(
      1,
      Math.min(50, Math.floor(input.contextMessageCount)),
    );
  }
  if ("modelOverride" in input) {
    const raw = input.modelOverride;
    if (raw === null || raw === "") {
      patch.modelOverride = null;
    } else if (typeof raw === "string") {
      patch.modelOverride = raw.trim().slice(0, 100);
    }
  }
  if ("escalationKeywordsOverride" in input) {
    const raw = input.escalationKeywordsOverride;
    if (raw === null) {
      patch.escalationKeywordsOverride = null;
    } else if (Array.isArray(raw)) {
      patch.escalationKeywordsOverride = raw
        .filter((v): v is string => typeof v === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 25);
    }
  }
  if ("escalationNotifyEmailOverride" in input) {
    const raw = input.escalationNotifyEmailOverride;
    if (raw === null || raw === "") {
      patch.escalationNotifyEmailOverride = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        patch.escalationNotifyEmailOverride = trimmed;
      }
    }
  }
  // Web-chat-only block. Merge over the existing webChat object so a
  // partial PATCH (e.g. just the welcomeMessage) doesn't wipe the other
  // fields. The merge happens server-side after we re-read.
  if ("webChat" in input) {
    const block = sanitiseWebChatBlock(input.webChat);
    if (Object.keys(block).length > 0) {
      // Stamp as Partial — the merge with the existing doc happens in
      // the PATCH handler below where we have the current config.
      patch.webChat = block as WebChatChannelConfig;
    }
  }

  return patch;
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; channel: string }> },
) {
  const { id, channel } = await ctx.params;
  if (!isValidChannel(channel)) {
    return NextResponse.json({ error: "Unknown channel" }, { status: 404 });
  }
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch = sanitisePatch(body);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No valid fields in patch" },
      { status: 400 },
    );
  }

  // Enabling a channel without a profile prompt = bot would call the LLM
  // with empty persona. Block at the API level so the UX can't bypass it
  // via direct API calls.
  if (patch.enabled === true) {
    const profile = await getAgentProfile(id);
    if (!profile || !profile.systemPrompt.trim()) {
      return NextResponse.json(
        {
          error:
            "Set the Agent persona on the Overview page before enabling this channel.",
        },
        { status: 400 },
      );
    }
  }

  // For web-chat, merge the inbound partial webChat block with the
  // existing one so a one-field PATCH doesn't blow away the others.
  // Also seed defaults on first save so the doc always has every field.
  if (channel === "web-chat" && patch.webChat) {
    const existing = await getChannelConfig(id, channel);
    const base: WebChatChannelConfig =
      existing?.webChat ?? { ...DEFAULT_WEB_CHAT_CONFIG };
    patch.webChat = { ...base, ...patch.webChat };
  }

  await upsertChannelConfig(id, channel, patch);
  const updated = await getChannelConfig(id, channel);
  return NextResponse.json({ ok: true, config: updated });
}
