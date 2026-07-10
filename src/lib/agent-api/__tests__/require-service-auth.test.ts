import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return {
    getAdminDb: () => fakeDb,
    getAdminAuth: () => {
      throw new Error("getAdminAuth not used by agent routes");
    },
  };
});

import { requireServiceAuth, subAccountAllowed } from "@/lib/auth/require-service-auth";

function reqWithKey(key?: string): Request {
  return new Request("http://test/api/agent/v1/contacts", {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });
}

function seedKey(over: Record<string, unknown> = {}) {
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1",
    label: "test",
    keyHash: gen.keyHash,
    keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"],
    scopes: ["contacts:write", "contacts:read"],
    status: "active",
    ...over,
  });
  return gen;
}

describe("requireServiceAuth", () => {
  beforeEach(resetFakeDb);

  it("rejects missing/malformed/unknown keys with INVALID_KEY 401", async () => {
    for (const req of [reqWithKey(), reqWithKey("ugl_" + "0".repeat(40))]) {
      const res = await requireServiceAuth(req, { scope: "contacts:write" });
      expect(res).toBeInstanceOf(NextResponse);
      expect((res as NextResponse).status).toBe(401);
      const body = await (res as NextResponse).json();
      expect(body.error.code).toBe("INVALID_KEY");
    }
  });

  it("rejects revoked keys", async () => {
    const gen = seedKey({ status: "revoked" });
    const res = await requireServiceAuth(reqWithKey(gen.key), { scope: "contacts:write" });
    expect((res as NextResponse).status).toBe(401);
  });

  it("rejects missing scope with 403 SCOPE_MISSING", async () => {
    const gen = seedKey();
    const res = await requireServiceAuth(reqWithKey(gen.key), { scope: "deals:write" });
    expect((res as NextResponse).status).toBe(403);
    expect((await (res as NextResponse).json()).error.code).toBe("SCOPE_MISSING");
  });

  it("rejects sub-accounts outside the allowlist with 403 SUB_ACCOUNT_FORBIDDEN", async () => {
    const gen = seedKey();
    const res = await requireServiceAuth(reqWithKey(gen.key), {
      scope: "contacts:write",
      subAccountId: "subOther",
    });
    expect((res as NextResponse).status).toBe(403);
    expect((await (res as NextResponse).json()).error.code).toBe("SUB_ACCOUNT_FORBIDDEN");
  });

  it("returns AgentAccess on success and subAccountAllowed works", async () => {
    const gen = seedKey();
    const access = await requireServiceAuth(reqWithKey(gen.key), {
      scope: "contacts:write",
      subAccountId: "subMain",
    });
    expect(access).not.toBeInstanceOf(NextResponse);
    const a = access as Exclude<typeof access, NextResponse>;
    expect(a).toMatchObject({
      keyId: "key1",
      agencyId: "ag1",
      keyPrefix: gen.keyPrefix,
      subAccountId: "subMain",
    });
    expect(subAccountAllowed(a, "subMain")).toBe(true);
    expect(subAccountAllowed(a, "subOther")).toBe(false);
  });
});
