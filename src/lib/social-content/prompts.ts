/**
 * Prompt templates for the AI Social Content Generator.
 *
 * Single source of truth for the system prompts that drive the OpenRouter
 * calls in /api/social-content/generate-step. Centralized here so prompt
 * tuning can happen in one place without touching route code.
 */

import type { BusinessProfile, SocialPlatform } from "@/types/social-content";

const PLATFORM_RULES: Record<SocialPlatform, string> = {
  facebook:
    "1-3 sentences. Conversational, friendly. 1-2 emoji max. 0-3 hashtags at the end. No links inline — drive the call-to-action through wording, not URLs.",
  instagram:
    "1-2 sentence caption, then a line break, then 5-8 highly relevant hashtags. Emoji-heavy is fine. Avoid generic hashtags like #love or #photooftheday. Mix niche, local, and broader tags.",
  linkedin:
    "3-5 sentences. Professional, story-led, value-forward. Lead with a hook line, then context, then insight, then a soft CTA. 0-3 hashtags. No emoji unless extremely sparingly.",
  x: "≤280 characters total INCLUDING hashtags. Punchy, one clear idea. 1-2 hashtags max. Avoid threads — single-post format only in this output.",
};

const CONTENT_TYPES = [
  "educational tip relevant to the audience",
  "behind-the-scenes / day-in-the-life",
  "social proof / customer story (use a generic placeholder name like 'a recent client')",
  "offer or promotion mention",
  "community / local relevance",
  "question or poll to drive engagement",
];

export function buildSystemPrompt(profile: BusinessProfile): string {
  return `You are a senior social media manager who has run paid + organic campaigns for ${profile.industry} businesses, with deep familiarity with the ${profile.location} market.

You write in a ${profile.voice} voice. Your goal is to drive engagement and inbound leads — not vanity metrics.

About the business:
- Products / services: ${profile.products}
- Target audience: ${profile.audience}
- Location: ${profile.location}

Hard rules:
1. Never make specific medical, legal, or financial claims that could be misleading
2. Never invent specific prices, guarantees, or customer counts
3. Never use generic phrases like "in today's fast-paced world" or "are you struggling with"
4. Vary post structure — never start two posts the same way
5. Include the local market in at least 30% of posts (street names, neighborhoods, seasons, local events)`;
}

export function buildWeekPrompt(args: {
  weekIndex: number;
  platforms: SocialPlatform[];
  postsPerWeek: number;
  totalWeeks: number;
}): string {
  const { weekIndex, platforms, postsPerWeek, totalWeeks } = args;
  const platformInstructions = platforms
    .map((p) => `- ${p}: ${PLATFORM_RULES[p]}`)
    .join("\n");

  return `Generate ${postsPerWeek} posts per platform for week ${weekIndex + 1} of ${totalWeeks}.

Platforms enabled (${platforms.length}):
${platformInstructions}

Content variety requirements:
- Across the week's posts, cover at least 3 of these content types:
${CONTENT_TYPES.map((t) => `  · ${t}`).join("\n")}
- No two adjacent posts on the same content type
- Vary opening sentence structure between posts

Output format: STRICT JSON array, no commentary, no markdown code fences. Each object:
{
  "dayOffset": <integer 0..${totalWeeks * 7 - 1}>,
  "platform": <one of "${platforms.join("|")}">,
  "caption": <string>,
  "hashtags": <array of strings, no # prefix>,
  "imagePrompt": <plain-text description of an ideal accompanying image, ~20 words>,
  "ctaText": <short call-to-action phrase, e.g. "Book today" or "DM us for a free quote">,
  "suggestedTime": <e.g. "Tuesday 7pm ET" — pick a best-practice posting time for that platform>
}

Generate exactly ${platforms.length * postsPerWeek} posts. Output ONLY the JSON array.`;
}

export { PLATFORM_RULES, CONTENT_TYPES };
