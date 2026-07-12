import { describe, expect, it } from "vitest";
import { parseBearerToken } from "../bearer";
describe("parseBearerToken", () => {
  it("extracts the token", () => expect(parseBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi"));
  it("null when missing", () => expect(parseBearerToken(null)).toBeNull());
  it("null when not Bearer", () => expect(parseBearerToken("Basic abc")).toBeNull());
  it("null when empty token", () => expect(parseBearerToken("Bearer ")).toBeNull());
  it("null with extra spaces / multiple parts", () => expect(parseBearerToken("Bearer a b")).toBeNull());
  it("case-sensitive scheme is fine either way", () => expect(parseBearerToken("bearer abc")).toBe("abc"));
});
