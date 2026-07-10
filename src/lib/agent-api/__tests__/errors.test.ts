import { describe, expect, it } from "vitest";
import { agentError } from "@/lib/agent-api/errors";

describe("agentError", () => {
  it("returns the typed envelope with status", async () => {
    const res = agentError("VALIDATION_FAILED", "email is invalid", 400);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "VALIDATION_FAILED", message: "email is invalid" },
    });
  });

  it("includes details and custom headers when given", async () => {
    const res = agentError("CAP_EXCEEDED", "daily cap reached", 429, { limit: 100 }, { "Retry-After": "3600" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    const body = await res.json();
    expect(body.error.details).toEqual({ limit: 100 });
  });
});
