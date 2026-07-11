import { describe, expect, it } from "vitest";
import { resolveMentions } from "../resolve-mentions";

describe("resolveMentions", () => {
  it("substitutes [Variable] slots", () => {
    const r = resolveMentions({
      content: "Write to [First_Name] at [Company].",
      gems: [], variables: { First_Name: "Ada", Company: "Acme" },
    });
    expect(r.resolved).toBe("Write to Ada at Acme.");
    expect(r.missingVariables).toEqual([]);
  });

  it("reports missing variables without substituting them", () => {
    const r = resolveMentions({ content: "Hi [Name]", gems: [], variables: {} });
    expect(r.resolved).toBe("Hi [Name]");
    expect(r.missingVariables).toEqual(["Name"]);
  });

  it("expands @Gem mentions with a context block, longest name first", () => {
    const r = resolveMentions({
      content: "Match @Brand Bio Pro and @Brand Bio.",
      gems: [
        { name: "Brand Bio", dataContent: "SHORT" },
        { name: "Brand Bio Pro", dataContent: "LONG" },
      ],
      variables: {},
    });
    expect(r.resolved).toContain("--- Context: Brand Bio Pro ---\nLONG");
    expect(r.resolved).toContain("--- Context: Brand Bio ---\nSHORT");
    expect(r.missingGems).toEqual([]);
  });

  it("reports @mentions that match no gem", () => {
    const r = resolveMentions({ content: "Use @Nonexistent Gem here", gems: [], variables: {} });
    expect(r.missingGems).toEqual(["Nonexistent Gem here"]); // best-effort capture up to line end
    expect(r.resolved).toContain("@Nonexistent");
  });

  it("handles empty content", () => {
    const r = resolveMentions({ content: "", gems: [], variables: {} });
    expect(r).toEqual({ resolved: "", missingVariables: [], missingGems: [] });
  });
});
