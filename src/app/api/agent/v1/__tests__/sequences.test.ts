import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { GET, POST } from "@/app/api/agent/v1/sequences/route";

let KEY: string;

beforeEach(() => {
  resetFakeDb();
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1", label: "t", keyHash: gen.keyHash, keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"], scopes: ["sequences:write", "sequences:enroll", "reports:read"], status: "active",
  });
  KEY = gen.key;

  // Seed templates
  fakeDb.doc("message_templates/t1").set({
    subAccountId: "subMain",
    agencyId: "ag1",
    type: "email",
    name: "E1",
    subject: "S",
    body: "b {{unsubscribeLink}}",
  });
  fakeDb.doc("message_templates/t-sms").set({
    subAccountId: "subMain",
    agencyId: "ag1",
    type: "sms",
    name: "SMS1",
    body: "sms text",
  });
});

function post(body: unknown): Request {
  return new Request("http://test/api/agent/v1/sequences", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("agent sequences", () => {
  it("creates a tag-triggered outbound sequence", async () => {
    const res = await POST(post({
      subAccountId: "subMain", name: "Box1 follow-ups", tag: "box1",
      steps: [{ templateId: "t1", delaySeconds: 0 }, { templateId: "t1", delaySeconds: 345600 }],
    }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()).data;
    const doc = (await fakeDb.doc(`automations/${id}`).get()).data()!;
    expect(doc).toMatchObject({
      recipeType: "outbound_sequence",
      enabled: true,
      trigger: { type: "tag_added", formId: null, tag: "box1" },
      agencyId: "ag1", subAccountId: "subMain",
    });
    expect((doc.config as { steps: unknown[] }).steps).toHaveLength(2);
    expect(doc.createdByUid).toMatch(/^agent:/);
    // stored doc carries its own id (engine loads automations by doc data)
    expect(doc.id).toBe(id);
  });

  it("rejects sms templates and missing templates", async () => {
    const sms = await POST(post({ subAccountId: "subMain", name: "X", steps: [{ templateId: "t-sms", delaySeconds: 0 }] }));
    expect(sms.status).toBe(400);
    const missing = await POST(post({ subAccountId: "subMain", name: "X", steps: [{ templateId: "ghost", delaySeconds: 0 }] }));
    expect(missing.status).toBe(400);
  });

  it("lists only outbound sequences for the sub-account", async () => {
    await POST(post({ subAccountId: "subMain", name: "A", steps: [{ templateId: "t1", delaySeconds: 0 }] }));
    fakeDb.doc("automations/nurture1").set({ subAccountId: "subMain", recipeType: "lead_nurture", name: "N", enabled: true });
    const res = await GET(new Request("http://t/api/agent/v1/sequences?subAccountId=subMain", { headers: { authorization: `Bearer ${KEY}` } }));
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ name: "A", stepCount: 1 });
  });
});
