export interface ResolveInput {
  content: string;
  gems: Array<{ name: string; dataContent: string }>;
  variables: Record<string, string>;
}
export interface ResolveResult {
  resolved: string;
  missingVariables: string[];
  missingGems: string[];
}

const SLOT_RE = /\[([A-Za-z0-9_ ]+)\]/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveMentions({ content, gems, variables }: ResolveInput): ResolveResult {
  let resolved = content;
  const missingGems: string[] = [];

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
  const seenGemKeys: Set<string> = new Set();
  for (const m of resolved.matchAll(/@([^\n@]+)/g)) {
    const key = m[1].trim();
    if (!seenGemKeys.has(key)) {
      seenGemKeys.add(key);
      missingGems.push(key);
    }
  }

  // Variables.
  const missingVariables: string[] = [];
  resolved = resolved.replace(SLOT_RE, (whole, name: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, name)) return variables[name];
    if (!missingVariables.includes(name)) missingVariables.push(name);
    return whole;
  });

  return { resolved, missingVariables, missingGems };
}
