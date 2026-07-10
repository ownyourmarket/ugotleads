import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return {
    getAdminDb: () => fakeDb,
    getAdminAuth: () => ({
      getUser: async (uid: string) => {
        if (uid === "rejecting1") throw new Error("user not found");
        if (uid === "owner1")
          return { customClaims: { status: "active", agencyId: "ag1", agencyRole: "owner" } };
        return { customClaims: { status: "active", agencyId: "ag1", agencyRole: "staff" } };
      },
    }),
  };
});

import { POST, GET } from "@/app/api/agency/service-keys/route";
import { DELETE } from "@/app/api/agency/service-keys/[id]/route";

function mintReq(uid: string, body: unknown): Request {
  return new Request("http://test/api/agency/service-keys", {
    method: "POST",
    headers: { "x-user-uid": uid, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("service key management", () => {
  beforeEach(() => {
    resetFakeDb();
    fakeDb.doc("subAccounts/subMain").set({ agencyId: "ag1", name: "Main" });
    fakeDb.doc("subAccounts/subForeign").set({ agencyId: "agOther", name: "X" });
  });

  it("mints a key for the agency owner and returns plaintext once", async () => {
    const res = await POST(
      mintReq("owner1", {
        label: "suit-bridge",
        allowedSubAccounts: ["subMain"],
        scopes: ["contacts:write"],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.key).toMatch(/^ugl_[a-f0-9]{40}$/);
    const stored = await fakeDb.doc(`agencyServiceKeys/${body.data.id}`).get();
    expect(stored.data()?.keyHash).toBeDefined();
    expect(stored.data()?.key).toBeUndefined(); // plaintext never stored
  });

  it("401s when the x-user-uid header is missing", async () => {
    const req = new Request("http://test/api/agency/service-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "x", allowedSubAccounts: ["subMain"], scopes: ["contacts:write"] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("401s when getUser rejects for the given uid", async () => {
    const res = await POST(
      mintReq("rejecting1", { label: "x", allowedSubAccounts: ["subMain"], scopes: ["contacts:write"] }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects non-owners with 403", async () => {
    const res = await POST(
      mintReq("staff1", { label: "x", allowedSubAccounts: ["subMain"], scopes: ["contacts:write"] }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects sub-accounts belonging to another agency", async () => {
    const res = await POST(
      mintReq("owner1", { label: "x", allowedSubAccounts: ["subForeign"], scopes: ["contacts:write"] }),
    );
    expect(res.status).toBe(400);
  });

  it("lists keys without hashes and revokes", async () => {
    const mint = await POST(
      mintReq("owner1", { label: "a", allowedSubAccounts: ["subMain"], scopes: ["contacts:read"] }),
    );
    const { id } = (await mint.json()).data;
    const list = await GET(mintReq("owner1", {}));
    const listBody = await list.json();
    expect(listBody.data[0].keyHash).toBeUndefined();
    const del = await DELETE(mintReq("owner1", {}), { params: Promise.resolve({ id }) });
    expect((await del.json()).data.status).toBe("revoked");
    expect((await fakeDb.doc(`agencyServiceKeys/${id}`).get()).data()?.status).toBe("revoked");
  });
});
