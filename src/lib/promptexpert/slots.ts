/**
 * Shared PromptExpert slot/mention helpers — pure functions with no
 * framework or Firestore dependencies. Used by the skills page (run-panel
 * variable detection), the prompts page (`[Variable]` highlighting), and
 * anywhere else that needs to reason about `[Variable]` slots or `@Gem`
 * mentions without pulling in the resolver engine.
 */

/** Matches `[Variable Name]` slots. Always construct a fresh instance via
 *  `new RegExp(SLOT_RE)` (or use the helpers below) before using `.exec`/
 *  `.test` in a loop — a shared global-flag RegExp carries `lastIndex`
 *  state between calls. */
export const SLOT_RE = /\[([A-Za-z0-9_ ]+)\]/g;

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Regex that matches a whole `@GemName` mention — i.e. not a prefix of a
 * longer mention (`@Brand Bio` must not match inside `@Brand Bio Pro`).
 * Returns a fresh RegExp instance each call so callers can safely `.test()`
 * it without worrying about shared `lastIndex` state.
 */
export function gemMentionRegex(gemName: string): RegExp {
  return new RegExp(`@${escapeRegExp(gemName)}(?![A-Za-z0-9_])`, "g");
}

/**
 * Extracts `[Variable Name]` slots from text, in order of first
 * appearance, deduped.
 */
export function extractVars(text: string): string[] {
  return [...new Set([...text.matchAll(SLOT_RE)].map((m) => m[1]))];
}

/** Split text into non-slot / slot segments so `[Variable]` slots can be
 *  rendered highlighted. */
export function splitSlots(content: string): Array<{ text: string; isSlot: boolean }> {
  const parts: Array<{ text: string; isSlot: boolean }> = [];
  const re = new RegExp(SLOT_RE);
  let last = 0;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    if (m.index > last) parts.push({ text: content.slice(last, m.index), isSlot: false });
    parts.push({ text: m[0], isSlot: true });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ text: content.slice(last), isSlot: false });
  return parts;
}
