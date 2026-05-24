import type { Timestamp, FieldValue } from "firebase/firestore";

/**
 * AI Agents architecture (post-refactor):
 *
 *   - One **shared profile** per sub-account at
 *     `subAccounts/{id}/aiAgent/profile` — the bot's identity. Persona,
 *     brand voice, business hours, default escalation rules. Configured
 *     once in the AI Agents → Overview area.
 *
 *   - One **per-channel config** per sub-account at
 *     `subAccounts/{id}/aiAgent/{channelId}` — operational settings for
 *     that channel. Enabled toggle, model override, context size, and
 *     optional overrides of the profile's escalation defaults.
 *
 * The webhook resolver merges profile + channel into an effective config
 * before calling the LLM. Channel overrides win when set, profile values
 * fill the gaps.
 *
 * Legacy `subAccounts/{id}/aiConfig/main` (the pre-refactor doc) is
 * auto-migrated into the new shape on first read — see agent.ts.
 */

/** Identity + brand voice. Shared across every channel the agent speaks
 *  on. Disabled by default at the channel level — flipping a channel on
 *  requires this profile to have a non-empty systemPrompt. */
export interface AiAgentProfile {
  systemPrompt: string;
  /** Injected into the prompt as {{businessName}}. Falls back to the
   *  sub-account's name if blank. */
  businessName: string;
  /** Hours during which AI auto-replies are active across all channels.
   *  Channels can in theory override later if needed, but in practice a
   *  business has one set of operating hours. */
  hoursStart: number;
  hoursEnd: number;
  /** IANA timezone, e.g. "Australia/Sydney". */
  timezone: string;
  /** Default escalation triggers. Channels can override with their own
   *  list (SMS users type "manager"; voice users might say something
   *  different) or extend by adding their own. */
  escalationKeywords: string[];
  /** Where escalation notifications go by default. Channels can override
   *  to route per-channel (e.g. voice escalations to a different team). */
  escalationNotifyEmail: string | null;
  /** Optional public website for this client. When set, the operator can
   *  trigger a Firecrawl scrape to populate websiteKb — a markdown blob
   *  the agent uses as additional context when replying. Validated as
   *  a real URL on save. */
  websiteUrl: string | null;
  /** Snapshot of the homepage content (markdown), capped at ~6000 chars.
   *  Populated by /ai-agent/profile/refresh-kb. Null until first refresh
   *  or after the operator clears the URL. */
  websiteKb: string | null;
  /** When the KB snapshot above was last refreshed. UI shows "Last
   *  refreshed 2h ago" so the operator knows whether to re-crawl. */
  websiteKbFetchedAt: Timestamp | FieldValue | null;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

export const DEFAULT_AI_AGENT_PROFILE: Omit<
  AiAgentProfile,
  "createdAt" | "updatedAt"
> = {
  systemPrompt: "",
  businessName: "",
  hoursStart: 9,
  hoursEnd: 17,
  timezone: "Australia/Sydney",
  // NB: keep these tight. The matcher is substring-based (case-insensitive),
  // so anything too generic ("human", "help") will swallow legitimate
  // conversion intents like "I want to talk to a human" — the bot would
  // then silently escalate instead of asking for contact details.
  // Visitor-wants-a-human is handled by the [[form]] marker in the
  // system prompt; reserve escalation for hostility / give-up signals.
  escalationKeywords: ["complaint", "refund", "stop ai", "speak to manager"],
  escalationNotifyEmail: null,
  websiteUrl: null,
  websiteKb: null,
  websiteKbFetchedAt: null,
};

/** Per-channel operational config. Stored at
 *  `subAccounts/{id}/aiAgent/{channelId}`. One doc per channel id. */
export interface AiChannelConfig {
  enabled: boolean;
  /** How many of the most-recent thread messages to feed the LLM. */
  contextMessageCount: number;
  /** OpenRouter model id, e.g. "anthropic/claude-haiku-4-5". Null =
   *  fall back to the deployment-wide AI_REPLIES_DEFAULT_MODEL. */
  modelOverride: string | null;
  /** Optional channel-specific overrides of the profile's escalation
   *  defaults. Null = use the profile value. Empty array = explicitly
   *  no escalation keywords on this channel. */
  escalationKeywordsOverride: string[] | null;
  escalationNotifyEmailOverride: string | null;
  /** Informational lifetime running total. Not enforced. */
  totalTokensUsed: number;
  /** Web-chat-specific config — populated only on the `web-chat` channel
   *  doc, null elsewhere. The widget loader reads these via the public
   *  /api/web-chat/config endpoint to theme + gate access. */
  webChat: WebChatChannelConfig | null;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

/** Web-chat-channel-only settings. Lives at
 *  `subAccounts/{id}/aiAgent/web-chat`.webChat. */
export interface WebChatChannelConfig {
  /** Hostnames allowed to load the widget. Origin header is compared
   *  case-insensitively. Empty list = no domain restriction (test mode
   *  only — should never be empty in production). Each entry is just the
   *  hostname (no protocol, no path), e.g. ["example.com", "www.example.com"]. */
  allowedDomains: string[];
  /** First bot message shown when the visitor opens the widget. */
  welcomeMessage: string;
  /** Accent color hex (e.g. "#7c3aed"). Used for the bubble background +
   *  send button. The rest of the widget chrome is neutral. */
  accentColor: string;
  /** Where the floating bubble sits on the host page. */
  position: "right" | "left";
}

export const DEFAULT_AI_CHANNEL_CONFIG: Omit<
  AiChannelConfig,
  "createdAt" | "updatedAt"
> = {
  enabled: false,
  contextMessageCount: 10,
  modelOverride: null,
  escalationKeywordsOverride: null,
  escalationNotifyEmailOverride: null,
  totalTokensUsed: 0,
  webChat: null,
};

export const DEFAULT_WEB_CHAT_CONFIG: WebChatChannelConfig = {
  allowedDomains: [],
  welcomeMessage: "Hi! How can I help?",
  accentColor: "#7c3aed",
  position: "right",
};

/** The merged result of profile + channel, ready for the LLM call. */
export interface ResolvedAiAgent {
  profile: AiAgentProfile;
  channel: AiChannelConfig;
  /** Effective values after applying channel overrides. */
  effective: {
    enabled: boolean;
    systemPrompt: string;
    businessName: string;
    hoursStart: number;
    hoursEnd: number;
    timezone: string;
    escalationKeywords: string[];
    escalationNotifyEmail: string | null;
    contextMessageCount: number;
    modelOverride: string | null;
    websiteKb: string | null;
  };
}

/** Why a given inbound text did NOT receive an AI reply. Persisted to the
 *  activity timeline so the operator can debug a quiet bot. */
export type AiSkipReason =
  | "disabled"
  | "no_prompt"
  | "outside_hours"
  | "escalation_keyword"
  | "contact_opted_out"
  | "no_contact_match"
  | "llm_failed";
