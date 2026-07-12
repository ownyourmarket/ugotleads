import { describe, expect, it } from "vitest";
import { isBearerApiPath } from "../bearer-api-paths";

describe("isBearerApiPath", () => {
  it.each([
    "/api/sub-accounts/abc123/promptexpert/run",
    "/api/sub-accounts/x/promptexpert/gpts/g1/chat",
  ])("matches intended bearer route: %s", (pathname) => {
    expect(isBearerApiPath(pathname)).toBe(true);
  });

  it.each([
    "/api/sub-accounts/x/promptexpert/gpts", // list — no /chat suffix
    "/api/sub-accounts/x/promptexpert/gpts/g1", // single gpt — no /chat suffix
    "/api/sub-accounts/x/promptexpert/run/extra", // extra trailing segment
    "/api/sub-accounts/x/promptexpert/skills", // neighboring promptexpert route
    "/api/sub-accounts/x/other", // unrelated sub-account route
    "/api/agent/v1/run", // unrelated agent API
    "/promptexpert", // public page, not the bearer API
  ])("rejects neighboring path: %s", (pathname) => {
    expect(isBearerApiPath(pathname)).toBe(false);
  });
});
