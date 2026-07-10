import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});
const publishStepMock = vi.fn(async (_args: unknown) => ({ messageId: "qstash-m1" }));
vi.mock("@/lib/automations/qstash", () => ({
  publishStep: (args: unknown) => publishStepMock(args),
  qstashIsConfigured: () => true,
  publishCallback: vi.fn(),
  verifyQStashSignature: vi.fn(),
}));

import { POST as ENROLL } from "@/app/api/agent/v1/sequences/[id]/enroll/route";
import { POST as UNENROLL } from "@/app/api/agent/v1/sequences/[id]/unenroll/route";
import { GET as STATUS } from "@/app/api/agent/v1/sequences/[id]/status/route";

let KEY: string;
const ctx = { params: Promise.resolve({ id: "seq1" }) };

function post(body: unknown): Request {
  return new Request("http://test/api/agent/v1/sequences/seq1/enroll", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetFakeDb();
  publishStepMock.mockClear();
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1", label: "t", keyHash: gen.keyHash, keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"], scopes: ["sequences:enroll", "reports:read"], status: "active",
  });
  KEY = gen.key;

  fakeDb.doc("automations/seq1").set({
    id: "seq1",
    agencyId: "ag1",
    subAccountId: "subMain",
    recipeType: "outbound_sequence",
    name: "Box1 follow-ups",
    enabled: true,
    trigger: { type: "manual", formId: null, tag: null },
    config: {
      steps: [
        { channel: "email", templateId: "t1", delaySeconds: 0 },
        { channel: "email", templateId: "t2", delaySeconds: 345600 },
      ],
    },
    createdByUid: "agent:ugl_test",
    createdAt: null,
    updatedAt: null,
  });

  fakeDb.doc("contacts/c1").set({ subAccountId: "subMain", tags: ["box1"] });
  fakeDb.doc("contacts/c2").set({ subAccountId: "subMain", tags: ["box1"] });
  fakeDb.doc("contacts/c3").set({ subAccountId: "subMain", tags: [] });
});

describe("agent sequence enroll/unenroll/status", () => {
  it("refuses enrollment without a matching confirm (batch-approval gate)", async () => {
    const noConfirm = await ENROLL(post({ contactIds: ["c1"] }), ctx);
    expect(noConfirm.status).toBe(409);
    expect((await noConfirm.json()).error.code).toBe("CONFIRM_MISMATCH");
    const badCount = await ENROLL(post({ contactIds: ["c1", "c2"], confirm: { expectedCount: 5, summary: "x" } }), ctx);
    expect(badCount.status).toBe(409);
  });

  it("enrolls by ids with confirm; re-run is a clean catch-up", async () => {
    const res = await ENROLL(post({ contactIds: ["c1", "c2"], confirm: { expectedCount: 2, summary: "Box1 batch" } }), ctx);
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ enrolled: 2, alreadyEnrolled: 0 });
    const rerun = await ENROLL(post({ contactIds: ["c1", "c2"], confirm: { expectedCount: 2, summary: "Box1 batch" } }), ctx);
    expect((await rerun.json()).data).toMatchObject({ enrolled: 0, alreadyEnrolled: 2 });
  });

  it("enrolls by tag and reports skips for unknown ids", async () => {
    const byTag = await ENROLL(post({ tag: "box1", confirm: { expectedCount: 2, summary: "tag sync" } }), ctx);
    expect((await byTag.json()).data.enrolled).toBe(2);
    const withGhost = await ENROLL(post({ contactIds: ["ghost"], confirm: { expectedCount: 1, summary: "g" } }), ctx);
    expect((await withGhost.json()).data.skipped).toEqual([{ contactId: "ghost", reason: "not_found" }]);
  });

  it("unenroll stops running executions; status rolls up", async () => {
    await ENROLL(post({ contactIds: ["c1"], confirm: { expectedCount: 1, summary: "s" } }), ctx);
    const un = await UNENROLL(post({ contactIds: ["c1", "c3"] }), ctx);
    expect((await un.json()).data).toMatchObject({ stopped: 1, notRunning: 1 });
    expect((await fakeDb.doc("automation_executions/seq1_c1").get()).data()).toMatchObject({ status: "stopped", stoppedReason: "manual" });
    const st = await STATUS(new Request("http://t/x", { headers: { authorization: `Bearer ${KEY}` } }), ctx);
    expect((await st.json()).data.counts.stopped).toBe(1);
  });

  it("enforces the daily enrollment cap in units", async () => {
    const day = new Date().toISOString().slice(0, 10);
    fakeDb.doc(`agencyServiceKeys/key1/usage/${day}`).set({ enrollments: 499 });
    const res = await ENROLL(post({ contactIds: ["c1", "c2"], confirm: { expectedCount: 2, summary: "s" } }), ctx);
    expect(res.status).toBe(429);
  });
});
