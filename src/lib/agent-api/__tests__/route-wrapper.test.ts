import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";

describe("withAgentRoute", () => {
  it("passes through the handler's response", async () => {
    const h = withAgentRoute(async () => NextResponse.json({ data: 1 }, { status: 201 }));
    const res = await h(new Request("http://t/x"), undefined);
    expect(res.status).toBe(201);
  });

  it("converts thrown errors to the INTERNAL_ERROR envelope without leaking details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = withAgentRoute(async () => {
      throw new Error("firestore exploded at /secret/path");
    });
    const res = await h(new Request("http://t/x"), undefined);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret");
    spy.mockRestore();
  });
});
