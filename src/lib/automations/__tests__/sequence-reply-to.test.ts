import { beforeEach, describe, expect, it } from "vitest";
import { resolveSequenceReplyTo } from "../sequence-reply-to";

beforeEach(() => {
  process.env.AUTOMATIONS_TOKEN_SECRET = "test-secret-please-ignore-0123456789";
});

describe("resolveSequenceReplyTo", () => {
  it("outbound_sequence + inboundDomain set -> HMAC-signed reply token address", () => {
    const result = resolveSequenceReplyTo({
      recipeType: "outbound_sequence",
      recipientKind: "contact",
      contactId: "c1",
      subAccountReplyTo: "star@myusa.com",
      inboundDomain: "hey.test",
    });
    expect(result).toMatch(/^reply\+c1\.[a-f0-9]{12}@hey\.test$/);
  });

  it("outbound_sequence without inboundDomain -> falls back to subAccountReplyTo", () => {
    const result = resolveSequenceReplyTo({
      recipeType: "outbound_sequence",
      recipientKind: "contact",
      contactId: "c1",
      subAccountReplyTo: "star@myusa.com",
      inboundDomain: null,
    });
    expect(result).toBe("star@myusa.com");
  });

  it("lead_nurture with inboundDomain set -> still subAccountReplyTo, NOT tokenized", () => {
    const result = resolveSequenceReplyTo({
      recipeType: "lead_nurture",
      recipientKind: "contact",
      contactId: "c1",
      subAccountReplyTo: "star@myusa.com",
      inboundDomain: "hey.test",
    });
    expect(result).toBe("star@myusa.com");
  });

  it("static recipient -> undefined", () => {
    const result = resolveSequenceReplyTo({
      recipeType: "outbound_sequence",
      recipientKind: "static",
      contactId: "c1",
      subAccountReplyTo: "star@myusa.com",
      inboundDomain: "hey.test",
    });
    expect(result).toBeUndefined();
  });

  it("falls back to subAccountReplyTo when the token secret is unset", () => {
    delete process.env.AUTOMATIONS_TOKEN_SECRET;
    const result = resolveSequenceReplyTo({
      recipeType: "outbound_sequence",
      recipientKind: "contact",
      contactId: "c1",
      subAccountReplyTo: "star@myusa.com",
      inboundDomain: "hey.test",
    });
    expect(result).toBe("star@myusa.com");
  });

  it("no subAccountReplyTo and no viable token -> undefined", () => {
    const result = resolveSequenceReplyTo({
      recipeType: "outbound_sequence",
      recipientKind: "contact",
      contactId: "c1",
      subAccountReplyTo: null,
      inboundDomain: null,
    });
    expect(result).toBeUndefined();
  });
});
