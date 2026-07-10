import { describe, expect, it } from "vitest";
import { generateServiceKey, hashServiceKey } from "@/lib/agent-api/keys";

describe("service keys", () => {
  it("generates ugl_-prefixed 44-char keys with matching hash and prefix", () => {
    const { key, keyHash, keyPrefix } = generateServiceKey();
    expect(key).toMatch(/^ugl_[a-f0-9]{40}$/);
    expect(keyPrefix).toBe(key.slice(0, 8));
    expect(keyHash).toBe(hashServiceKey(key));
    expect(keyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("generates unique keys", () => {
    expect(generateServiceKey().key).not.toBe(generateServiceKey().key);
  });
});
