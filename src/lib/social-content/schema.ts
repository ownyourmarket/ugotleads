/**
 * Validation + parse helpers for AI-generated social posts.
 *
 * The LLM is instructed to output strict JSON, but practical reality is
 * 1-5% of calls return JSON wrapped in markdown fences, with trailing
 * commentary, or with subtle schema drift. These helpers tolerate that.
 */

import type { GeneratedPost, SocialPlatform } from "@/types/social-content";

const VALID_PLATFORMS: SocialPlatform[] = ["facebook", "instagram", "linkedin", "x"];

/**
 * Parse the LLM output into an array of posts, tolerating markdown fences
 * and trailing/leading commentary. Returns null if the output is unsalvageable.
 */
export function parseGeneratedPosts(raw: string): GeneratedPost[] | null {
  // Strip markdown fences
  let trimmed = raw.trim();
  trimmed = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");

  // Find the first [ and last ] — tolerates leading commentary
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;

  const jsonSlice = trimmed.slice(start, end + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  const valid: GeneratedPost[] = [];
  for (const item of parsed) {
    if (!isValidPost(item)) continue;
    valid.push(item);
  }
  return valid.length > 0 ? valid : null;
}

function isValidPost(p: unknown): p is GeneratedPost {
  if (typeof p !== "object" || p === null) return false;
  const obj = p as Record<string, unknown>;
  if (typeof obj.dayOffset !== "number") return false;
  if (typeof obj.platform !== "string") return false;
  if (!VALID_PLATFORMS.includes(obj.platform as SocialPlatform)) return false;
  if (typeof obj.caption !== "string" || obj.caption.length === 0) return false;
  if (typeof obj.caption === "string" && obj.caption.length > 3000) return false;
  if (!Array.isArray(obj.hashtags)) return false;
  if (obj.hashtags.length > 12) return false;
  if (typeof obj.imagePrompt !== "string") return false;
  if (typeof obj.ctaText !== "string") return false;
  return true;
}

/**
 * X-platform character cap enforcement. Mutates caption to fit if too long.
 * Returns the post (possibly with truncated caption).
 */
export function enforcePlatformLimits(post: GeneratedPost): GeneratedPost {
  if (post.platform === "x") {
    const hashtagBlock = post.hashtags.map((h) => `#${h}`).join(" ");
    const maxCaptionLen = Math.max(0, 280 - hashtagBlock.length - 1);
    if (post.caption.length > maxCaptionLen) {
      return {
        ...post,
        caption: post.caption.slice(0, maxCaptionLen - 1) + "…",
      };
    }
  }
  return post;
}
