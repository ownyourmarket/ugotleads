import { beforeEach, describe, expect, it } from "vitest";
import { buildReplyToken, verifyReplyToken } from "../reply-token";

beforeEach(() => {
  // Same env var unsubscribe-token.ts reads (AUTOMATIONS_TOKEN_SECRET),
  // >=16 chars required.
  process.env.AUTOMATIONS_TOKEN_SECRET = "test-secret-please-ignore-0123456789";
});

describe("buildReplyToken / verifyReplyToken", () => {
  it("round-trips: build then verify returns the same contactId", () => {
    const token = buildReplyToken("c1");
    expect(token).toMatch(/^c1\.[a-f0-9]{12}$/);
    expect(verifyReplyToken(token!)).toBe("c1");
  });

  it("rejects a tampered hmac", () => {
    const token = buildReplyToken("c1")!;
    const [contactId] = token.split(".");
    const tampered = `${contactId}.000000000000`;
    expect(tampered).not.toBe(token);
    expect(verifyReplyToken(tampered)).toBeNull();
  });

  it("rejects a tampered contactId (hmac no longer matches)", () => {
    const token = buildReplyToken("c1")!;
    const hmac = token.split(".")[1];
    const tampered = `c2.${hmac}`;
    expect(verifyReplyToken(tampered)).toBeNull();
  });

  it("rejects malformed tokens: no dot", () => {
    expect(verifyReplyToken("nodothere")).toBeNull();
  });

  it("rejects malformed tokens: empty string", () => {
    expect(verifyReplyToken("")).toBeNull();
  });

  it("rejects malformed tokens: empty contactId before the dot", () => {
    expect(verifyReplyToken(".abcdef012345")).toBeNull();
  });

  it("returns null (never throws) when the secret is unset", () => {
    delete process.env.AUTOMATIONS_TOKEN_SECRET;
    expect(buildReplyToken("c1")).toBeNull();
    expect(verifyReplyToken("c1.abcdef012345")).toBeNull();
  });

  it("returns null (never throws) when the secret is too short", () => {
    process.env.AUTOMATIONS_TOKEN_SECRET = "short";
    expect(buildReplyToken("c1")).toBeNull();
    expect(verifyReplyToken("c1.abcdef012345")).toBeNull();
  });
});
