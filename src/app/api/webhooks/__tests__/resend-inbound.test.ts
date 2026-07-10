import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { buildReplyToken } from "@/lib/automations/reply-token";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

const sendEmailMock = vi.fn(async (_args: unknown) => ({ id: "resend_out_1" }));
vi.mock("@/lib/comms/resend", () => ({
  sendEmail: (args: unknown) => sendEmailMock(args),
  emailIsConfigured: () => true,
}));

import { POST } from "@/app/api/webhooks/resend-inbound/route";

let secretB64: string;

function sign(id: string, ts: string, body: string): string {
  return createHmac("sha256", Buffer.from(secretB64, "base64"))
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
}

function signedRequest(
  eventBody: unknown,
  opts?: { badSig?: boolean }
): Request {
  const body = JSON.stringify(eventBody);
  const id = `msg_${randomUUID()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const sigValue = opts?.badSig
    ? Buffer.from("not-a-real-signature").toString("base64")
    : sign(id, ts, body);
  return new Request("http://test/api/webhooks/resend-inbound", {
    method: "POST",
    headers: {
      "svix-id": id,
      "svix-timestamp": ts,
      "svix-signature": `v1,${sigValue}`,
      "content-type": "application/json",
    },
    body,
  });
}

beforeEach(() => {
  resetFakeDb();
  sendEmailMock.mockClear();
  secretB64 = randomBytes(24).toString("base64");
  process.env.RESEND_INBOUND_WEBHOOK_SECRET = `whsec_${secretB64}`;
  process.env.AUTOMATIONS_TOKEN_SECRET = "test-secret-please-ignore-0123456789";

  fakeDb
    .doc("subAccounts/subMain")
    .set({ agencyId: "ag1", replyToEmail: "star@myusa.com" });
  fakeDb.doc("contacts/c1").set({
    email: "prospect@ex.com",
    subAccountId: "subMain",
    agencyId: "ag1",
    name: "Pat",
    tags: [],
  });
  fakeDb
    .doc("automations/seq1")
    .set({ recipeType: "outbound_sequence", name: "Box1" });
  fakeDb
    .doc("automations/nurt1")
    .set({ recipeType: "lead_nurture", name: "Nurture" });
  fakeDb.doc("automation_executions/seq1_c1").set({
    automationId: "seq1",
    contactId: "c1",
    status: "running",
    subAccountId: "subMain",
    agencyId: "ag1",
    history: [],
  });
  fakeDb.doc("automation_executions/nurtX").set({
    automationId: "nurt1",
    contactId: "c1",
    status: "running",
    subAccountId: "subMain",
    agencyId: "ag1",
    history: [],
  });
});

describe("POST /api/webhooks/resend-inbound", () => {
  it("401s on a bad signature and 503s when the secret is unset", async () => {
    const bad = await POST(
      signedRequest({ type: "email.received", data: {} }, { badSig: true })
    );
    expect(bad.status).toBe(401);

    delete process.env.RESEND_INBOUND_WEBHOOK_SECRET;
    const unset = await POST(
      signedRequest({ type: "email.received", data: {} })
    );
    expect(unset.status).toBe(503);
  });

  it("ingests a reply matched by plus-token, stops only the outbound sequence, forwards a copy", async () => {
    const token = buildReplyToken("c1")!;
    const res = await POST(
      signedRequest({
        type: "email.received",
        data: {
          email_id: "re_123",
          from: "Pat Prospect <prospect@ex.com>",
          to: [`reply+${token}@hey.ugotleads.io`],
          subject: "Re: Quick question",
          text: "Sounds interesting, call me",
        },
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).matched).toBe(true);

    const inbound = (await fakeDb.doc("inbound_emails/re_123").get()).data()!;
    expect(inbound).toMatchObject({
      contactId: "c1",
      matchedBy: "reply_token",
      handled: false,
      subAccountId: "subMain",
    });

    expect(
      (await fakeDb.doc("automation_executions/seq1_c1").get()).data()
    ).toMatchObject({ status: "stopped", stoppedReason: "replied" });
    expect(
      (await fakeDb.doc("automation_executions/nurtX").get()).data()?.status
    ).toBe("running");

    const acts = await fakeDb.collection("contacts/c1/activities").get();
    expect(acts.docs.some((d) => d.data()?.type === "email_reply")).toBe(true);

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "star@myusa.com" })
    );
  });

  it("falls back to unique from-email lookup and stores unmatched replies", async () => {
    const matchedRes = await POST(
      signedRequest({
        type: "email.received",
        data: {
          email_id: "re_A1",
          from: "prospect@ex.com",
          to: ["hello@hey.ugotleads.io"],
          subject: "Following up",
          text: "hi there",
        },
      })
    );
    expect(matchedRes.status).toBe(200);
    expect((await matchedRes.json()).matched).toBe(true);
    const matchedDoc = (await fakeDb.doc("inbound_emails/re_A1").get()).data();
    expect(matchedDoc).toMatchObject({
      contactId: "c1",
      matchedBy: "email_lookup",
    });

    const unmatchedRes = await POST(
      signedRequest({
        type: "email.received",
        data: {
          email_id: "re_B1",
          from: "unknown@nowhere.com",
          to: ["hello@hey.ugotleads.io"],
          subject: "spam?",
          text: "hey there",
        },
      })
    );
    expect(unmatchedRes.status).toBe(200);
    expect((await unmatchedRes.json()).matched).toBe(false);
    const unmatchedDoc = (
      await fakeDb.doc("inbound_emails/re_B1").get()
    ).data();
    expect(unmatchedDoc).toMatchObject({
      contactId: null,
      matchedBy: null,
      subAccountId: null,
      agencyId: null,
    });
  });

  it("falls through to from-email fallback on a bad-hmac reply token", async () => {
    const res = await POST(
      signedRequest({
        type: "email.received",
        data: {
          email_id: "re_badhmac",
          // Well-formed shape (dot + 12 hex chars) but the hmac is wrong —
          // verifyReplyToken must reject it, and since the from-email
          // matches no contact, the reply ends up unmatched (not an
          // error, not a false match).
          from: "unknown@nowhere.com",
          to: ["reply+c1.000000000000@hey.ugotleads.io"],
          subject: "spoofed?",
          text: "hi",
        },
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).matched).toBe(false);
    const doc = (await fakeDb.doc("inbound_emails/re_badhmac").get()).data();
    expect(doc).toMatchObject({ contactId: null, matchedBy: null });
  });

  it("ignores non-received event types", async () => {
    const res = await POST(
      signedRequest({ type: "email.bounced", data: { from: "x@y.com" } })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ignored: true });
    const all = await fakeDb.collection("inbound_emails").get();
    expect(all.size).toBe(0);
  });

  it("ignores a signed literal-null body without throwing", async () => {
    // JSON.parse("null") succeeds and returns null — the event-shape guard
    // must catch it before any property access (the brief's own skeleton
    // would have thrown on `event.type` outside the try/catch → 500).
    // signedRequest signs JSON.stringify(null) === "null" exactly.
    const res = await POST(signedRequest(null));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ignored: true });
    const all = await fakeDb.collection("inbound_emails").get();
    expect(all.size).toBe(0);
  });

  it("never throws on malformed data shapes", async () => {
    const res = await POST(
      signedRequest({
        type: "email.received",
        data: {
          from: { email: "prospect@ex.com" },
          to: "reply+c1@hey.ugotleads.io",
          subject: null,
        },
      })
    );
    expect(res.status).toBe(200);
  });
});
