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

export function resolveMentions({ content, gems, variables }: ResolveInput): ResolveResult {
  let resolved = content;
  const missingGems: string[] = [];

  // Gems first (longest name first so "Brand Bio Pro" wins over "Brand Bio").
  const byLength = [...gems].sort((a, b) => b.name.length - a.name.length);
  for (const gem of byLength) {
    const mention = `@${gem.name}`;
    if (resolved.includes(mention)) {
      const block = `\n\n--- Context: ${gem.name} ---\n${gem.dataContent}\n--- End context ---\n\n`;
      resolved = resolved.split(mention).join(block);
    }
  }
  // Any @Something left (up to end of line) matched no gem.
  for (const m of resolved.matchAll(/@([^\n@]+)/g)) {
    missingGems.push(m[1].trim());
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
