import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});
const publishStepMock = vi.fn(async (_args: unknown) => ({
  messageId: "qstash-m1",
}));
vi.mock("@/lib/automations/qstash", () => ({
  publishStep: (args: unknown) => publishStepMock(args),
  qstashIsConfigured: () => true,
  publishCallback: vi.fn(),
  verifyQStashSignature: vi.fn(),
}));

import { fireTagAddedTriggers } from "@/lib/automations/tag-triggers";

function seedSequenceAutomation(id: string, tag: string) {
  fakeDb.doc(`automations/${id}`).set({
    id,
    agencyId: "ag1",
    subAccountId: "subMain",
    recipeType: "outbound_sequence",
    name: `seq-${id}`,
    enabled: true,
    trigger: { type: "tag_added", formId: null, tag },
    config: {
      steps: [{ channel: "email", templateId: "t1", delaySeconds: 0 }],
    },
    createdByUid: "u1",
  });
}

describe("fireTagAddedTriggers", () => {
  beforeEach(() => {
    resetFakeDb();
    publishStepMock.mockClear();
    fakeDb.doc("subAccounts/subMain").set({ agencyId: "ag1" });
  });

  it("enrolls the contact in sequences whose trigger tag matches", async () => {
    seedSequenceAutomation("autoA", "box1");
    seedSequenceAutomation("autoB", "other-tag");
    await fireTagAddedTriggers({
      agencyId: "ag1",
      subAccountId: "subMain",
      contactId: "c1",
      addedTags: ["box1"],
    });
    expect(
      (await fakeDb.doc("automation_executions/autoA_c1").get()).exists
    ).toBe(true);
    expect(
      (await fakeDb.doc("automation_executions/autoB_c1").get()).exists
    ).toBe(false);
  });

  it("is idempotent across repeated fires and skips paused sub-accounts", async () => {
    seedSequenceAutomation("autoA", "box1");
    await fireTagAddedTriggers({
      agencyId: "ag1",
      subAccountId: "subMain",
      contactId: "c1",
      addedTags: ["box1", "box1"],
    });
    publishStepMock.mockClear();
    await fireTagAddedTriggers({
      agencyId: "ag1",
      subAccountId: "subMain",
      contactId: "c1",
      addedTags: ["box1"],
    });
    expect(publishStepMock).not.toHaveBeenCalled();

    fakeDb
      .doc("subAccounts/subMain")
      .set({ agencyId: "ag1", automationsPaused: true });
    await fireTagAddedTriggers({
      agencyId: "ag1",
      subAccountId: "subMain",
      contactId: "c2",
      addedTags: ["box1"],
    });
    expect(
      (await fakeDb.doc("automation_executions/autoA_c2").get()).exists
    ).toBe(false);
  });

  it("normalizes tags to their 50-char truncation before matching (parity with buildContactDoc)", async () => {
    const truncated = "a".repeat(50);
    const overlong = "a".repeat(60);
    seedSequenceAutomation("autoA", truncated);
    await fireTagAddedTriggers({
      agencyId: "ag1",
      subAccountId: "subMain",
      contactId: "c1",
      addedTags: [overlong],
    });
    expect(
      (await fakeDb.doc("automation_executions/autoA_c1").get()).exists
    ).toBe(true);
  });
});
