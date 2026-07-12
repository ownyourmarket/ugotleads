/**
 * Ported verbatim (TS types stripped) from
 * ../../src/lib/promptexpert/resolve-mentions.ts — keep logic byte-identical.
 *
 * ResolveInput:  { content: string, gems: Array<{ name, dataContent }>, variables: Record<string,string> }
 * ResolveResult: { resolved: string, missingVariables: string[], missingGems: string[] }
 */

const SLOT_RE = /\[([A-Za-z0-9_ ]+)\]/g;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveMentions({ content, gems, variables }) {
  let resolved = content;
  const missingGems = [];

  // Gems first (longest name first so "Brand Bio Pro" wins over "Brand Bio").
  const byLength = [...gems].sort((a, b) => b.name.length - a.name.length);
  for (const gem of byLength) {
    const block = `\n\n--- Context: ${gem.name} ---\n${gem.dataContent}\n--- End context ---\n\n`;
    const mentionRe = new RegExp(`@${escapeRegExp(gem.name)}(?![A-Za-z0-9_])`, "g");
    if (mentionRe.test(resolved)) {
      resolved = resolved.replace(mentionRe, block);
    }
  }
  // Any @Something left (up to end of line, or up to the next mention) matched no gem.
  // Dedup by the full trimmed phrase to preserve distinct mentions that happen
  // to share a leading word (e.g., "@Alpha One" and "@Alpha Two" are distinct).
  const seenGemKeys = new Set();
  for (const m of resolved.matchAll(/@([^\n@]+)/g)) {
    const key = m[1].trim();
    if (!seenGemKeys.has(key)) {
      seenGemKeys.add(key);
      missingGems.push(key);
    }
  }

  // Variables.
  const missingVariables = [];
  resolved = resolved.replace(SLOT_RE, (whole, name) => {
    if (Object.prototype.hasOwnProperty.call(variables, name)) return variables[name];
    if (!missingVariables.includes(name)) missingVariables.push(name);
    return whole;
  });

  return { resolved, missingVariables, missingGems };
}
