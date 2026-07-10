import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { GET, POST } from "@/app/api/agent/v1/templates/route";
import { PATCH } from "@/app/api/agent/v1/templates/[id]/route";

let KEY: string;

beforeEach(() => {
  resetFakeDb();
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1", label: "t", keyHash: gen.keyHash, keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"], scopes: ["templates:read", "templates:write"], status: "active",
  });
  KEY = gen.key;
});

function post(body: unknown): Request {
  return new Request("http://test/api/agent/v1/templates", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_EMAIL_BODY = "Hi {{name}},\n\nFollowing up.\n\nUnsubscribe: {{unsubscribeLink}}";

describe("agent templates", () => {
  it("creates an email template with a valid body", async () => {
    const res = await POST(
      post({ subAccountId: "subMain", type: "email", name: "Box1 Email 2", subject: "Quick follow-up", body: VALID_EMAIL_BODY }),
    );
    expect(res.status).toBe(201);
    const { id } = (await res.json()).data;
    const doc = (await fakeDb.doc(`message_templates/${id}`).get()).data()!;
    expect(doc).toMatchObject({ type: "email", subAccountId: "subMain", agencyId: "ag1" });
  });

  it("rejects an email template missing the unsubscribe link", async () => {
    const res = await POST(
      post({ subAccountId: "subMain", type: "email", name: "Bad", subject: "S", body: "no link here" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
  });

  it("lists templates filtered by type", async () => {
    await POST(post({ subAccountId: "subMain", type: "email", name: "E", subject: "S", body: VALID_EMAIL_BODY }));
    await POST(post({ subAccountId: "subMain", type: "sms", name: "S", body: "short text" }));
    const res = await GET(
      new Request("http://test/api/agent/v1/templates?subAccountId=subMain&type=email", {
        headers: { authorization: `Bearer ${KEY}` },
      }),
    );
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].type).toBe("email");
  });

  it("patches a template and re-validates the email body", async () => {
    const createRes = await POST(
      post({ subAccountId: "subMain", type: "email", name: "E", subject: "S", body: VALID_EMAIL_BODY }),
    );
    const { id } = (await createRes.json()).data;
    const bad = await PATCH(
      new Request("http://test/x", {
        method: "PATCH",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ body: "stripped the link" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(bad.status).toBe(400);
  });

  it("rejects POST with non-string name (hardening)", async () => {
    const res = await POST(
      post({ subAccountId: "subMain", type: "email", name: 42, subject: "S", body: VALID_EMAIL_BODY }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
  });
});
