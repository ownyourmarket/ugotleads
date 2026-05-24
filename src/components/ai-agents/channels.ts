import {
  Bot,
  Mail,
  MessageCircle,
  MessageSquare,
  PhoneCall,
  Star,
  type LucideIcon,
} from "lucide-react";

/**
 * Single source of truth for the AI Agents channel surface. Every nav
 * tab, every Overview status card, every Coming Soon page reads from
 * this list — adding a future channel means appending one entry and
 * dropping its `comingSoon` flag once shipped.
 */

export type AiChannelId =
  | "overview"
  | "sms"
  | "voice"
  | "email"
  | "web-chat"
  | "google-business";

export interface AiChannel {
  id: AiChannelId;
  label: string;
  /** Used in the Overview cards + ComingSoon hero. */
  blurb: string;
  icon: LucideIcon;
  /** True when the channel page should render the ComingSoon placeholder
   *  instead of real config. Flip to false when the channel ships. */
  comingSoon: boolean;
  /** When true, the channel is omitted from the nav tabs + Overview grid.
   *  The page route still resolves (renders ComingSoon) if visited
   *  directly. Use this to park channels that aren't a near-term priority
   *  without deleting the work. */
  hidden?: boolean;
  /** URL slug under /sa/{id}/ai-agents/. Empty string for the Overview. */
  slug: string;
}

export const AI_CHANNELS: AiChannel[] = [
  {
    id: "overview",
    label: "Overview",
    blurb: "Status of every AI agent channel on this sub-account.",
    icon: Bot,
    comingSoon: false,
    slug: "",
  },
  {
    id: "web-chat",
    label: "Web Chat",
    blurb:
      "Own-brand chat widget for your website. AI handles inbound, escalates to a human when needed.",
    icon: MessageCircle,
    comingSoon: false,
    slug: "web-chat",
  },
  {
    id: "sms",
    label: "SMS",
    blurb:
      "AI auto-replies to inbound text messages in real time. Per-sub-account persona, business hours, escalation rules.",
    icon: MessageSquare,
    comingSoon: false,
    slug: "sms",
  },
  {
    id: "voice",
    label: "Voice",
    blurb:
      "AI answers inbound voice calls, qualifies the lead, and books a callback. Same persona as your SMS agent.",
    icon: PhoneCall,
    comingSoon: true,
    slug: "voice",
  },
  {
    id: "email",
    label: "Email",
    blurb:
      "AI auto-responds to inbound emails using the same brand voice and contact context as SMS.",
    icon: Mail,
    comingSoon: true,
    hidden: true,
    slug: "email",
  },
  {
    id: "google-business",
    label: "Google Business",
    blurb:
      "AI replies to Google Business Profile reviews and Q&A. Keeps your reputation responsive without manual work.",
    icon: Star,
    comingSoon: true,
    hidden: true,
    slug: "google-business",
  },
];

export function getChannel(id: AiChannelId): AiChannel {
  const found = AI_CHANNELS.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown AI channel: ${id}`);
  return found;
}

/**
 * The set of channels surfaced in the UI (nav tabs + Overview grid).
 * Hidden channels are filtered out — their pages still exist and resolve
 * if a URL is hit directly, they just don't appear in navigation.
 */
export const VISIBLE_AI_CHANNELS: AiChannel[] = AI_CHANNELS.filter(
  (c) => !c.hidden,
);

export function buildChannelHref(
  subAccountId: string,
  channel: AiChannel,
): string {
  const base = `/sa/${subAccountId}/ai-agents`;
  return channel.slug ? `${base}/${channel.slug}` : base;
}

// Generic global icon for the nav item itself.
export { Bot as AiAgentsIcon };
