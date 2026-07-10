import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

const sendEmailMock = vi.fn(async () => ({ id: "resend-msg-1" }));
vi.mock("@/lib/comms/resend", () => ({
  emailIsConfigured: () => true,
  sendEmail: async (args: unknown) => sendEmailMock(args),
}));
vi.mock("@/lib/comms/usage", () => ({ recordSend: vi.fn(async () => {}) }));

import { POST } from "@/app/api/agent/v1/messages/email/route";

let KEY: string;

beforeEach(() => {
  resetFakeDb();
  sendEmailMock.mockClear();
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1", label: "t", keyHash: gen.keyHash, keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"], scopes: ["sends:execute"], status: "active",
  });
  KEY = gen.key;
  fakeDb.doc("subAccounts/subMain").set({ agencyId: "ag1", replyToEmail: "star@myusa.com" });
  fakeDb.doc("contacts/c1").set({
    name: "Ann", email: "ann@ex.com", subAccountId: "subMain", agencyId: "ag1",
    tags: [], emailOptedOut: false, smsOptedOut: false,
  });
  fakeDb.doc("contacts/cOpted").set({
    name: "Out", email: "out@ex.com", subAccountId: "subMain", agencyId: "ag1",
    tags: [], emailOptedOut: true, smsOptedOut: false,
  });
});

function post(body: unknown, idemKey?: string): Request {
  return new Request("http://test/api/agent/v1/messages/email", {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      ...(idemKey ? { "idempotency-key": idemKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("agent one-off email", () => {
  it("sends with the sub-account replyTo and logs an agent activity", async () => {
    const res = await POST(post({ contactId: "c1", subject: "Hello", body: "Hi Ann" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe("resend-msg-1");
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ann@ex.com", replyTo: "star@myusa.com" }),
    );
    const acts = await fakeDb.collection("contacts/c1/activities").get();
    expect(acts.docs[0].data()).toMatchObject({ type: "email_sent" });
    expect(acts.docs[0].data()?.createdBy).toMatch(/^agent:/);
  });

  it("409s CONTACT_OPTED_OUT for opted-out contacts and does not send", async () => {
    const res = await POST(post({ contactId: "cOpted", subject: "S", body: "B" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CONTACT_OPTED_OUT");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("replays idempotent sends without re-sending", async () => {
    await POST(post({ contactId: "c1", subject: "S", body: "B" }, "send-1"));
    const res = await POST(post({ contactId: "c1", subject: "S", body: "B" }, "send-1"));
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(res.headers.get("x-idempotent-replay")).toBe("true");
  });

  it("enforces the daily cap", async () => {
    // Pre-load today's counter to the cap.
    const day = new Date().toISOString().slice(0, 10);
    fakeDb.doc(`agencyServiceKeys/key1/usage/${day}`).set({ sends: 100 });
    const res = await POST(post({ contactId: "c1", subject: "S", body: "B" }));
    expect(res.status).toBe(429);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("400s on non-string contactId without crash", async () => {
    const res = await POST(post({ contactId: 42, subject: "S", body: "B" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
