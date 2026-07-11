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
  // Dedup by the mention's leading word: greedy capture can bleed trailing filler
  // text into an earlier mention (e.g. "@Nope x @Nope"), so two matches that start
  // with the same word are treated as the same missing gem.
  const seenGemKeys: string[] = [];
  for (const m of resolved.matchAll(/@([^\n@]+)/g)) {
    const name = m[1].trim();
    const key = name.split(/\s+/)[0];
    if (!seenGemKeys.includes(key)) {
      seenGemKeys.push(key);
      missingGems.push(name);
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
