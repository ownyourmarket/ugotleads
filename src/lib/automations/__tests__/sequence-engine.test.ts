import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import type { AutomationDoc } from "@/types";

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

import { planSteps } from "@/lib/automations/executor";
import { enrollContact } from "@/lib/automations/triggers";

function seqAutomation(over: Partial<AutomationDoc> = {}): AutomationDoc {
  return {
    id: "auto1",
    agencyId: "ag1",
    subAccountId: "subMain",
    recipeType: "outbound_sequence",
    name: "Box1 follow-ups",
    enabled: true,
    trigger: { type: "manual", formId: null, tag: null },
    config: {
      steps: [
        { channel: "email", templateId: "t2", delaySeconds: 345600 }, // day 4
        { channel: "email", templateId: "t1", delaySeconds: 0 }, // day 0
      ],
    },
    createdByUid: "agent:ugl_test",
    createdAt: null,
    updatedAt: null,
    ...over,
  } as AutomationDoc;
}

describe("outbound_sequence engine", () => {
  beforeEach(() => {
    resetFakeDb();
    publishStepMock.mockClear();
  });

  it("planSteps sorts by delay and converts to relative-from-previous", () => {
    const steps = planSteps(seqAutomation());
    expect(steps.map((s) => s.templateId)).toEqual(["t1", "t2"]);
    expect(steps.map((s) => s.delaySeconds)).toEqual([0, 345600]);
    expect(steps.every((s) => s.recipient.kind === "contact")).toBe(true);
  });

  it("enrollContact creates a deterministic execution and schedules step 0", async () => {
    const outcome = await enrollContact({
      agencyId: "ag1",
      subAccountId: "subMain",
      automation: seqAutomation(),
      contactId: "c1",
    });
    expect(outcome).toBe("enrolled");
    const exec = await fakeDb.doc("automation_executions/auto1_c1").get();
    expect(exec.exists).toBe(true);
    expect(exec.data()).toMatchObject({
      status: "running",
      automationId: "auto1",
      contactId: "c1",
    });
    expect(publishStepMock).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: "auto1_c1", stepIndex: 0 })
    );
    const acts = await fakeDb.collection("contacts/c1/activities").get();
    expect(acts.docs.some((d) => d.data()?.type === "automation_started")).toBe(
      true
    );
  });

  it("enrollContact is idempotent forever — second call is already_enrolled, no reschedule", async () => {
    const input = {
      agencyId: "ag1",
      subAccountId: "subMain",
      automation: seqAutomation(),
      contactId: "c1",
    };
    await enrollContact(input);
    publishStepMock.mockClear();
    const outcome = await enrollContact(input);
    expect(outcome).toBe("already_enrolled");
    expect(publishStepMock).not.toHaveBeenCalled();
  });

  it("enrollContact with an empty-step config returns no_steps", async () => {
    const a = seqAutomation({
      config: { steps: [] },
    } as Partial<AutomationDoc>);
    expect(
      await enrollContact({
        agencyId: "ag1",
        subAccountId: "subMain",
        automation: a,
        contactId: "c1",
      })
    ).toBe("no_steps");
  });

  it("failed enrollment (QStash publish fails) is retryable after recovery", async () => {
    publishStepMock.mockResolvedValueOnce(null as never);
    const input = {
      agencyId: "ag1",
      subAccountId: "subMain",
      automation: seqAutomation(),
      contactId: "c9",
    };
    expect(await enrollContact(input)).toBe("failed");
    expect(
      (await fakeDb.doc("automation_executions/auto1_c9").get()).exists
    ).toBe(false);
    expect(await enrollContact(input)).toBe("enrolled");
    expect(
      (await fakeDb.doc("automation_executions/auto1_c9").get()).data()?.status
    ).toBe("running");
  });
});
