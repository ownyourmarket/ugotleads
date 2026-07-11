import { describe, expect, it, vi } from "vitest";
import { validateGptFields, assertSameTenantRefs, type RefEntry } from "../gpt-validation";

describe("validateGptFields", () => {
  it("rejects an empty-string id in pinnedGemIds (the crash case)", () => {
    const r = validateGptFields({ name: "GPT", pinnedGemIds: ["", "abc"] }, { requireName: true });
    expect(r).toMatchObject({ ok: false, status: 422, error: "cross_tenant_ref" });
  });

  it("rejects a whitespace-only id in allowedSkillIds", () => {
    const r = validateGptFields({ name: "GPT", allowedSkillIds: ["   "] }, { requireName: true });
    expect(r).toMatchObject({ ok: false, status: 422, error: "cross_tenant_ref" });
  });

  it("rejects a non-string element in a ref array", () => {
    const r = validateGptFields({ name: "GPT", pinnedGemIds: [123] }, { requireName: true });
    expect(r).toMatchObject({ ok: false, status: 422, error: "cross_tenant_ref" });
  });

  it("rejects an empty-string basePromptId", () => {
    const r = validateGptFields({ name: "GPT", basePromptId: "" }, { requireName: true });
    expect(r).toMatchObject({ ok: false, status: 422, error: "cross_tenant_ref" });
  });

  it("accepts a null basePromptId", () => {
    const r = validateGptFields({ name: "GPT", basePromptId: null }, { requireName: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields.basePromptId).toBeNull();
  });

  it("rejects a ref array longer than 20", () => {
    const ids = Array.from({ length: 21 }, (_, i) => `gem${i}`);
    const r = validateGptFields({ name: "GPT", pinnedGemIds: ids }, { requireName: true });
    expect(r).toMatchObject({ ok: false, status: 422, error: "cross_tenant_ref" });
  });

  it("accepts a ref array of exactly 20", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `gem${i}`);
    const r = validateGptFields({ name: "GPT", pinnedGemIds: ids }, { requireName: true });
    expect(r.ok).toBe(true);
  });

  it("rejects an empty name on POST (requireName: true)", () => {
    const r = validateGptFields({ name: "" }, { requireName: true });
    expect(r).toMatchObject({ ok: false, status: 400, error: "invalid_name" });
  });

  it("rejects a missing name on POST", () => {
    const r = validateGptFields({}, { requireName: true });
    expect(r).toMatchObject({ ok: false, status: 400, error: "invalid_name" });
  });

  it("rejects a name over 120 characters", () => {
    const r = validateGptFields({ name: "x".repeat(121) }, { requireName: true });
    expect(r).toMatchObject({ ok: false, status: 400, error: "invalid_name" });
  });

  it("allows a missing name on PATCH (requireName: false)", () => {
    const r = validateGptFields({}, { requireName: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields.name).toBeUndefined();
  });

  describe("creditCostPerMessage parsing", () => {
    it("truncates a fractional string down (\"5.7\" -> 5)", () => {
      const r = validateGptFields({ name: "GPT", creditCostPerMessage: "5.7" }, { requireName: true });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.fields.creditCostPerMessage).toBe(5);
    });

    it("floors a negative value at 0 (\"-3\" -> 0)", () => {
      const r = validateGptFields({ name: "GPT", creditCostPerMessage: "-3" }, { requireName: true });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.fields.creditCostPerMessage).toBe(0);
    });

    it("defaults to 1 when undefined on POST", () => {
      const r = validateGptFields({ name: "GPT" }, { requireName: true });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.fields.creditCostPerMessage).toBe(1);
    });

    it("leaves creditCostPerMessage unset on PATCH when omitted", () => {
      const r = validateGptFields({}, { requireName: false });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.fields.creditCostPerMessage).toBeUndefined();
    });
  });

  it("dedupes duplicate ids across ref fields in the returned refs list", () => {
    const r = validateGptFields(
      { name: "GPT", basePromptId: "p1", pinnedGemIds: ["g1", "g1"], allowedSkillIds: ["g1"] },
      { requireName: true },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      // g1 appears in pinnedGemIds (twice) and allowedSkillIds (different
      // collection) -- collection+id dedupe should collapse the two
      // pe_gems/g1 entries into one, while keeping pe_skills/g1 distinct.
      const gemRefs = r.refs.filter((x) => x.collection === "pe_gems" && x.id === "g1");
      expect(gemRefs).toHaveLength(1);
      expect(r.refs).toEqual(
        expect.arrayContaining([
          { collection: "pe_prompts", id: "p1" },
          { collection: "pe_gems", id: "g1" },
          { collection: "pe_skills", id: "g1" },
        ]),
      );
      expect(r.refs).toHaveLength(3);
    }
  });

  it("passes the happy-path fields through unchanged on POST", () => {
    const r = validateGptFields(
      {
        name: "My GPT",
        description: "desc",
        basePromptId: "p1",
        pinnedGemIds: ["g1", "g2"],
        allowedSkillIds: ["s1"],
        creditCostPerMessage: 3,
      },
      { requireName: true },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields).toMatchObject({
        name: "My GPT",
        description: "desc",
        basePromptId: "p1",
        pinnedGemIds: ["g1", "g2"],
        allowedSkillIds: ["s1"],
        creditCostPerMessage: 3,
      });
    }
  });
});

describe("assertSameTenantRefs", () => {
  const REFS: RefEntry[] = [{ collection: "pe_gems", id: "g1" }];

  it("returns ok when refs is empty without calling loadRefs", async () => {
    const loadRefs = vi.fn();
    const r = await assertSameTenantRefs(loadRefs, [], "sa1");
    expect(r).toEqual({ ok: true });
    expect(loadRefs).not.toHaveBeenCalled();
  });

  it("rejects a missing doc", async () => {
    const loadRefs = vi.fn(async () => [{ exists: false }]);
    const r = await assertSameTenantRefs(loadRefs, REFS, "sa1");
    expect(r).toMatchObject({ ok: false, detail: "pe_gems/g1" });
  });

  it("rejects a doc belonging to a foreign sub-account", async () => {
    const loadRefs = vi.fn(async () => [{ exists: true, subAccountId: "OTHER" }]);
    const r = await assertSameTenantRefs(loadRefs, REFS, "sa1");
    expect(r).toMatchObject({ ok: false, detail: "pe_gems/g1" });
  });

  it("passes when every doc exists and matches the sub-account", async () => {
    const loadRefs = vi.fn(async () => [{ exists: true, subAccountId: "sa1" }]);
    const r = await assertSameTenantRefs(loadRefs, REFS, "sa1");
    expect(r).toEqual({ ok: true });
  });
});
