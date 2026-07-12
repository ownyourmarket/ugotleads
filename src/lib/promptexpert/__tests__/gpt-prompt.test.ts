import { describe, expect, it } from "vitest";
import { buildGptSystemPrompt } from "../gpt-prompt";

describe("buildGptSystemPrompt", () => {
  it("assembles base prompt + gem context blocks + standing footer", () => {
    const out = buildGptSystemPrompt({
      basePromptContent: "You help with marketing copy.",
      gptName: "Marketing Assistant",
      gems: [{ name: "Brand Bio", dataContent: "Acme Corp, est. 1990." }],
    });
    expect(out).toBe(
      "You help with marketing copy.\n\n" +
        "--- Context: Brand Bio ---\nAcme Corp, est. 1990.\n--- End context ---\n\n" +
        'You are "Marketing Assistant". Stay in character and use the context above.'
    );
  });

  it("with null basePromptContent, output starts with gem blocks then footer (no leading blank junk)", () => {
    const out = buildGptSystemPrompt({
      basePromptContent: null,
      gptName: "Support Bot",
      gems: [{ name: "FAQ", dataContent: "Refunds within 30 days." }],
    });
    expect(out).toBe(
      "--- Context: FAQ ---\nRefunds within 30 days.\n--- End context ---\n\n" +
        'You are "Support Bot". Stay in character and use the context above.'
    );
    expect(out.startsWith("\n")).toBe(false);
  });

  it("with empty gems, emits no context blocks and no stray blank lines", () => {
    const out = buildGptSystemPrompt({
      basePromptContent: "Base instructions here.",
      gptName: "Plain GPT",
      gems: [],
    });
    expect(out).toBe(
      "Base instructions here.\n\n" +
        'You are "Plain GPT". Stay in character and use the context above.'
    );
    expect(out).not.toMatch(/\n{3,}/);
  });

  it("with null basePromptContent and empty gems, output is just the footer", () => {
    const out = buildGptSystemPrompt({
      basePromptContent: null,
      gptName: "Bare GPT",
      gems: [],
    });
    expect(out).toBe('You are "Bare GPT". Stay in character and use the context above.');
    expect(out).not.toMatch(/\n{3,}/);
  });
});
