export interface GptPromptInput {
  basePromptContent: string | null;
  gptName: string;
  gems: Array<{ name: string; dataContent: string }>;
}

export function buildGptSystemPrompt(input: GptPromptInput): string {
  const { basePromptContent, gptName, gems } = input;

  const parts: string[] = [];
  if (basePromptContent) parts.push(basePromptContent);
  for (const gem of gems) {
    parts.push(`--- Context: ${gem.name} ---\n${gem.dataContent}\n--- End context ---`);
  }
  parts.push(`You are "${gptName}". Stay in character and use the context above.`);

  return parts.join("\n\n");
}
