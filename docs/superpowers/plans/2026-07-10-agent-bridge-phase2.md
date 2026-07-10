# Agent Bridge Phase 2 — Outbound Sequences + Stop-on-Reply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cold contacts can be enrolled in a native drip sequence (manually or by tag), the existing QStash engine runs it 24/7, and a reply from a prospect stops their sequence automatically and lands in the CRM + Star's inbox.

**Architecture:** Extend the existing automation engine (new `outbound_sequence` recipe + `manual`/`tag_added` triggers reusing `planSteps`/`executeStep`/QStash unchanged), add idempotent enrollment via deterministic execution IDs (`{automationId}_{contactId}` + Firestore `create()`), a Resend inbound webhook with Svix signature verification and plus-addressed reply routing (`reply+<contactId>@<domain>`), and agent API routes (sequences CRUD/enroll/status, replies) built on a new shared `withAgentRoute` wrapper.

**Tech Stack:** Same as Phase 1 — Next.js 15.5 App Router, Firebase Admin SDK, Resend, QStash, Vitest (fake at `src/test/fake-admin.ts`), pnpm.

**Spec:** `docs/AGENT_BRIDGE_SPEC.md` sections 4.3, 4.4, plus the sequences/replies rows of 4.2. Decisions made at planning time (spec open question #1 resolved): sequence emails set `replyTo` to `reply+{contactId}@{INBOUND_REPLY_DOMAIN}`; the inbound webhook matches contacts by that token (fallback: unique from-email lookup), stores replies in a new `inbound_emails` collection, stops running `outbound_sequence` executions (`stoppedReason: "replied"`), and forwards a copy to `subAccount.replyToEmail` so the human inbox still sees everything.

## Global Constraints

- Everything from Phase 1's Global Constraints still binds (pnpm, `server-only`, envelope `{ data } / { error: { code, message, details? } }`, `agent:<keyPrefix>` stamping, Next 15 async `ctx.params`, no deploy without Star's explicit go).
- Work from a NEW worktree on branch `feature/agent-bridge-phase2` cut from `main` (0fcd757). Worktree must live OUTSIDE the repo directory (pnpm walks up to the repo's `pnpm-workspace.yaml`): use `C:\Users\starr\projects\ugotleads-worktrees\agent-bridge-phase2`. Copy `.env.local` from the main checkout for smoke steps only; never commit it.
- New env vars (prod setup is an operator step in Task 13): `RESEND_INBOUND_WEBHOOK_SECRET` (Svix `whsec_…` from the Resend webhook UI), `INBOUND_REPLY_DOMAIN` (e.g. `hey.ugotleads.io`). All inbound/reply features must degrade gracefully when unset (no crashes; sequences fall back to `subAccount.replyToEmail`).
- Caps: max **200 contacts per enroll call**; max **500 enrollments per key per UTC day** (`enforceDailyCap` cap name `"enrollments"`, counted in units); Phase 1's 100 sends/day unchanged.
- Sequences are **email-only** in v1 (SMS blocked on A2P — validate template type).
- Enrollment idempotency is absolute: at most one execution per (automationId, contactId) EVER, enforced by deterministic doc ID + `create()`.
- The enroll endpoint's confirm gate: request must carry `confirm: { expectedCount, summary }`; `expectedCount` must equal the resolved audience size or the call fails with 409 `CONFIRM_MISMATCH` — this is the governance batch-approval rail.
- Existing behavior must not regress: `form_submit` automations, broadcast sends, and the dashboard are untouched except where a task explicitly names them.
- The webhook route always returns 200 for structurally valid, signature-verified events (even unmatched ones) so Resend doesn't retry; 401 only for bad/missing signatures.

## File Structure

| File | Responsibility |
|---|---|
| `src/types/automations.ts` (modify) | New trigger types, recipe type, stop reason |
| `src/types/contacts.ts` (modify) | `ActivityType` gains `"email_reply"` |
| `src/types/inbound-emails.ts` (create) | `InboundEmailDoc` |
| `src/test/fake-admin.ts` (modify) | `FakeDocRef.create()` (throws code 6 if exists) |
| `src/lib/agent-api/route-wrapper.ts` (create) | `withAgentRoute()` — envelope-guaranteed try/catch |
| `src/lib/agent-api/idempotency.ts` (modify) | Endpoint-scoped doc IDs (`scope` param) |
| `src/lib/agent-api/caps.ts` (modify) | `"enrollments"` cap name + `units` param |
| `src/lib/automations/triggers.ts` (modify) | `enrollContact()` export, `tag_added` matching, outbound delay case |
| `src/lib/automations/tag-triggers.ts` (create) | `fireTagAddedTriggers()` helper |
| `src/lib/automations/executor.ts` (modify) | `outbound_sequence` in `planSteps` + reply-to routing |
| `src/lib/automations/sequence-reply-to.ts` (create) | Pure `resolveSequenceReplyTo()` (testable) |
| `src/lib/webhooks/svix-verify.ts` (create) | Manual Svix HMAC verification (no new dependency) |
| `src/app/api/webhooks/resend-inbound/route.ts` (create) | Inbound reply ingestion + stop-on-reply + forward |
| `src/middleware.ts` (modify) | PUBLIC_PATHS + `/api/webhooks/resend-inbound` |
| `src/app/api/agent/v1/sequences/route.ts` (create) | GET list, POST create |
| `src/app/api/agent/v1/sequences/[id]/enroll/route.ts` (create) | POST enroll (confirm gate, caps, catch-up sync) |
| `src/app/api/agent/v1/sequences/[id]/unenroll/route.ts` (create) | POST stop executions |
| `src/app/api/agent/v1/sequences/[id]/status/route.ts` (create) | GET execution rollup |
| `src/app/api/agent/v1/replies/route.ts` (create) | GET list replies |
| `src/app/api/agent/v1/replies/[id]/route.ts` (create) | PATCH mark handled |
| `src/app/api/contacts/bulk/route.ts` (modify) | Fire tag triggers after bulk tag |
| `src/app/api/contacts/merge/route.ts` (modify) | Fire tag triggers for merged tags |
| `src/app/api/agent/v1/contacts/route.ts`, `[id]/route.ts`, `import/route.ts` (modify) | Fire tag triggers on agent tag writes |
| Phase 1 hardening (Task 12): `deals/[id]`, `templates/*`, `messages/email`, `contact-defaults.ts`, `read-agency-owner.ts` tests, `mint-service-key.mjs` | Follow-up batch |
| `docs/AGENT_API.md` (modify) | Sequences/replies/webhook sections |

Tests mirror Phase 1: `__tests__/` next to modules. The `vi.mock("@/lib/firebase/admin", …)` pattern from Phase 1 tests is the template; engine tests additionally `vi.mock("@/lib/automations/qstash")`.

---

### Task 1: Worktree, branch, type extensions, fake `create()`

**Files:**
- Modify: `src/types/automations.ts:7-23` (unions + trigger)
- Modify: `src/types/contacts.ts:97-114` (ActivityType)
- Create: `src/types/inbound-emails.ts`
- Modify: `src/test/fake-admin.ts` (add `create()` to `FakeDocRef`)
- Test: `src/test/__tests__/fake-admin.test.ts` (one new case)

**Interfaces:**
- Produces: `AutomationTriggerType = "form_submit" | "manual" | "tag_added"`; `AutomationTrigger` gains `tag?: string | null`; `RecipeType` gains `"outbound_sequence"`; `OutboundSequenceConfig` (alias of `LeadNurtureConfig`); `StoppedReason` gains `"replied"`; `ActivityType` gains `"email_reply"`; `InboundEmailDoc`; `FakeDocRef.create(data)` that throws `{ code: 6 }` when the doc exists (mirrors Admin SDK ALREADY_EXISTS).

- [ ] **Step 1: Create the worktree + branch**

```bash
cd C:/Users/starr/projects/ugotleads-live
git worktree add ../ugotleads-worktrees/agent-bridge-phase2 -b feature/agent-bridge-phase2 main
cd ../ugotleads-worktrees/agent-bridge-phase2
pnpm install
pnpm test   # baseline: 73/73
```

Commit this plan file onto the branch first: copy `docs/superpowers/plans/2026-07-10-agent-bridge-phase2.md` from the main checkout if not present, `git add` + `git commit -m "docs: agent bridge phase 2 implementation plan"`.

- [ ] **Step 2: Extend the automation types**

In `src/types/automations.ts` apply exactly:

```ts
export type RecipeType = "instant_response" | "lead_nurture" | "outbound_sequence";

export type AutomationTriggerType = "form_submit" | "manual" | "tag_added";

export type StoppedReason =
  | "automation_disabled"
  | "manual"
  | "opt_out"
  | "booking"
  | "replied";

export interface AutomationTrigger {
  type: AutomationTriggerType;
  /** Required when type === "form_submit". */
  formId: string | null;
  /** Required when type === "tag_added" — the tag that enrolls a contact. */
  tag?: string | null;
}
```

And below `LeadNurtureConfig`:

```ts
/**
 * Recipe 3 — Outbound Sequence. Same step shape as lead nurture (delays are
 * absolute from ENROLLMENT), but enrollment is manual/tag-based (cold lists)
 * instead of form-triggered, enrollment is once-per-contact-ever, and a
 * reply from the contact stops the sequence (stoppedReason "replied").
 * Email-only in v1 (SMS pending A2P).
 */
export type OutboundSequenceConfig = LeadNurtureConfig;
```

Update the `RecipeConfig` union: `export type RecipeConfig = InstantResponseConfig | LeadNurtureConfig | OutboundSequenceConfig;` (note: `OutboundSequenceConfig` is an alias so this is a no-op structurally — keep it for readability).

- [ ] **Step 3: Add `"email_reply"` to `ActivityType`** in `src/types/contacts.ts` (append to the union after `"link_clicked"`).

- [ ] **Step 4: Create `src/types/inbound-emails.ts`**

```ts
import type { Timestamp, FieldValue } from "firebase/firestore";

/**
 * One received email, stored by the Resend inbound webhook in the
 * top-level `inbound_emails` collection. Matched replies carry contact +
 * tenancy ids; unmatched ones keep nulls and are stored for triage.
 */
export interface InboundEmailDoc {
  id: string;
  agencyId: string | null;
  subAccountId: string | null;
  contactId: string | null;
  /** How the contact was identified. */
  matchedBy: "reply_token" | "email_lookup" | null;
  /** Parsed sender email (lowercased) and raw From header. */
  fromEmail: string;
  fromRaw: string;
  /** All recipient addresses from the To header. */
  to: string[];
  subject: string;
  text: string;
  html: string | null;
  /** Resend identifiers, for audit / dedupe. */
  resendEmailId: string | null;
  messageId: string | null;
  handled: boolean;
  receivedAt: Timestamp | FieldValue | null;
  createdAt: Timestamp | FieldValue | null;
}
```

- [ ] **Step 5: Add `create()` to the fake — write the failing test first**

Add to `src/test/__tests__/fake-admin.test.ts`:

```ts
it("create() writes a new doc and throws code 6 on existing", async () => {
  await fakeDb.doc("execs/e1").create({ n: 1 });
  expect((await fakeDb.doc("execs/e1").get()).data()).toEqual({ n: 1 });
  await expect(fakeDb.doc("execs/e1").create({ n: 2 })).rejects.toMatchObject({ code: 6 });
  expect((await fakeDb.doc("execs/e1").get()).data()).toEqual({ n: 1 });
});
```

Run `pnpm test fake-admin` → FAIL (create is not a function). Implement in `FakeDocRef` (`src/test/fake-admin.ts`):

```ts
/** Mirrors Admin SDK create(): rejects with gRPC code 6 (ALREADY_EXISTS). */
async create(data: DocData): Promise<void> {
  if (this.db.store.has(this.path)) {
    throw Object.assign(new Error(`ALREADY_EXISTS: ${this.path}`), { code: 6 });
  }
  this.db.store.set(this.path, { ...data });
}
```

- [ ] **Step 6: Gates + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean, 74 tests.

```bash
git add src/types/automations.ts src/types/contacts.ts src/types/inbound-emails.ts src/test/fake-admin.ts src/test/__tests__/fake-admin.test.ts
git commit -m "feat(sequences): type extensions + fake create() for idempotent enrollment"
```

---

### Task 2: `withAgentRoute` wrapper + endpoint-scoped idempotency

**Files:**
- Create: `src/lib/agent-api/route-wrapper.ts`
- Modify: `src/lib/agent-api/idempotency.ts` (scope param)
- Modify: Phase 1 call sites: `src/app/api/agent/v1/contacts/route.ts`, `contacts/import/route.ts`, `deals/route.ts`, `messages/email/route.ts` (pass their scope; wrap handlers)
- Test: `src/lib/agent-api/__tests__/route-wrapper.test.ts`; extend `__tests__/idempotency-caps.test.ts`

**Interfaces:**
- Produces:
  ```ts
  withAgentRoute<Ctx>(handler: (request: Request, ctx: Ctx) => Promise<NextResponse>): (request: Request, ctx: Ctx) => Promise<NextResponse>
  // catches anything thrown → logs → agentError("INTERNAL_ERROR", "Unexpected server error.", 500)
  withIdempotency(request, keyId, scope: string, handler, opts?) // scope joins the doc id
  ```
- ALL new Phase 2 routes are exported as `export const POST = withAgentRoute(async (request, ctx) => { ... })`.

- [ ] **Step 1: Failing tests**

`src/lib/agent-api/__tests__/route-wrapper.test.ts`:

```ts
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
```

Add to `__tests__/idempotency-caps.test.ts`:

```ts
it("scopes idempotency per endpoint", async () => {
  let calls = 0;
  const handler = async () => ({ status: 200, body: { data: { n: ++calls } } });
  await withIdempotency(req("abc"), "key1", "contacts:create", handler);
  await withIdempotency(req("abc"), "key1", "deals:create", handler);
  expect(calls).toBe(2);
});
```

(Existing `withIdempotency` tests: update their calls to pass a scope string, e.g. `"test"` — behavior otherwise unchanged.)

Run: `pnpm test route-wrapper idempotency-caps` → FAIL.

- [ ] **Step 2: Implement**

`src/lib/agent-api/route-wrapper.ts`:

```ts
import "server-only";

import type { NextResponse } from "next/server";
import { agentError } from "@/lib/agent-api/errors";

/**
 * Guarantees the agent error envelope on unexpected failures. Every
 * /api/agent/v1 route handler should be wrapped: expected failures return
 * agentError(...) themselves; anything thrown lands here.
 */
export function withAgentRoute<Ctx = unknown>(
  handler: (request: Request, ctx: Ctx) => Promise<NextResponse>,
): (request: Request, ctx: Ctx) => Promise<NextResponse> {
  return async (request, ctx) => {
    try {
      return await handler(request, ctx);
    } catch (err) {
      console.error("[agent-api] unhandled route error", request.url, err);
      return agentError("INTERNAL_ERROR", "Unexpected server error.", 500);
    }
  };
}
```

`idempotency.ts`: change the signature to `withIdempotency(request, keyId, scope: string, handler, opts?)` and the doc id line to:

```ts
const docId = `${keyId}_${createHash("sha256").update(`${scope}\n${idemKey}`).digest("hex").slice(0, 32)}`;
```

- [ ] **Step 3: Retrofit Phase 1 call sites**

Update the four existing `withIdempotency(request, access.keyId, async () => …)` calls to pass scopes: `"contacts:create"`, `"contacts:import"`, `"deals:create"`, `"messages:email"` (keep each route's existing opts, e.g. the email route's `preflight`). Wrap each of those routes' exported handlers in `withAgentRoute` (mechanical: `export const POST = withAgentRoute(async (request) => { … })` — convert `export async function POST` accordingly; for `[id]` routes include the ctx generic `withAgentRoute<{ params: Promise<{ id: string }> }>`). Also wrap `reports/summary` and remove its now-redundant inner try/catch (keep the value-guard logic).

- [ ] **Step 4: Gates + commit**

Run: `pnpm exec tsc --noEmit && pnpm test` — all suites green (existing route tests must pass unchanged; they call the exported handlers the same way).

```bash
git add src/lib/agent-api src/app/api/agent/v1
git commit -m "feat(agent-api): withAgentRoute envelope wrapper + endpoint-scoped idempotency"
```

---

### Task 3: Engine — `outbound_sequence` planning + idempotent `enrollContact`

**Files:**
- Modify: `src/lib/automations/executor.ts:44-53` (planSteps switch) and export `planSteps`
- Modify: `src/lib/automations/triggers.ts` (delay case + `enrollContact` export)
- Test: `src/lib/automations/__tests__/sequence-engine.test.ts`

**Interfaces:**
- Consumes: `publishStep`/`qstashIsConfigured` from `./qstash` (mock in tests), fake admin.
- Produces:
  ```ts
  // executor.ts — planSteps becomes exported (signature unchanged)
  export function planSteps(automation: AutomationDoc): PlannedStep[]
  // triggers.ts
  export type EnrollOutcome = "enrolled" | "already_enrolled" | "no_steps" | "failed";
  export async function enrollContact(input: {
    agencyId: string; subAccountId: string; automation: AutomationDoc; contactId: string;
  }): Promise<EnrollOutcome>
  ```
- Enrollment doc ID is `${automation.id}_${contactId}` in `automation_executions`, written with `create()` — a second enroll of the same pair returns `"already_enrolled"` without touching QStash.

- [ ] **Step 1: Failing tests**

`src/lib/automations/__tests__/sequence-engine.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import type { AutomationDoc } from "@/types";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});
const publishStepMock = vi.fn(async () => ({ messageId: "qstash-m1" }));
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
        { channel: "email", templateId: "t1", delaySeconds: 0 },      // day 0
      ],
    },
    createdByUid: "agent:ugl_test",
    createdAt: null,
    updatedAt: null,
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
      agencyId: "ag1", subAccountId: "subMain", automation: seqAutomation(), contactId: "c1",
    });
    expect(outcome).toBe("enrolled");
    const exec = (await fakeDb.doc("automation_executions/auto1_c1").get());
    expect(exec.exists).toBe(true);
    expect(exec.data()).toMatchObject({ status: "running", automationId: "auto1", contactId: "c1" });
    expect(publishStepMock).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: "auto1_c1", stepIndex: 0 }),
    );
    const acts = await fakeDb.collection("contacts/c1/activities").get();
    expect(acts.docs.some((d) => d.data()?.type === "automation_started")).toBe(true);
  });

  it("enrollContact is idempotent forever — second call is already_enrolled, no reschedule", async () => {
    const input = { agencyId: "ag1", subAccountId: "subMain", automation: seqAutomation(), contactId: "c1" };
    await enrollContact(input);
    publishStepMock.mockClear();
    const outcome = await enrollContact(input);
    expect(outcome).toBe("already_enrolled");
    expect(publishStepMock).not.toHaveBeenCalled();
  });

  it("enrollContact with an empty-step config returns no_steps", async () => {
    const a = seqAutomation({ config: { steps: [] } } as Partial<AutomationDoc>);
    expect(await enrollContact({ agencyId: "ag1", subAccountId: "subMain", automation: a, contactId: "c1" })).toBe("no_steps");
  });
});
```

Run: `pnpm test sequence-engine` → FAIL (exports missing).

- [ ] **Step 2: Implement the executor change**

In `src/lib/automations/executor.ts`, change `function planSteps` to `export function planSteps` and extend the switch:

```ts
export function planSteps(automation: AutomationDoc): PlannedStep[] {
  switch (automation.recipeType) {
    case "instant_response":
      return planInstantResponse(automation.config as InstantResponseConfig);
    case "lead_nurture":
    case "outbound_sequence":
      // Identical step machinery — delays absolute-from-enrollment,
      // sorted + converted to relative in planLeadNurture.
      return planLeadNurture(automation.config as LeadNurtureConfig);
    default:
      return [];
  }
}
```

- [ ] **Step 3: Implement `enrollContact` in `triggers.ts`**

Extend `computeFirstStepDelay`'s switch: `case "lead_nurture":` gains a fall-through twin `case "outbound_sequence":` (same block). Then add at the bottom of the file:

```ts
export type EnrollOutcome = "enrolled" | "already_enrolled" | "no_steps" | "failed";

/**
 * Idempotent-forever enrollment for outbound sequences. Deterministic
 * execution id `${automationId}_${contactId}` + Firestore create() means a
 * contact can never be enrolled twice in the same sequence — not while
 * running, not after completion, not after a stop. This is the
 * anti-double-email guarantee and what makes tag catch-up sync safe to
 * re-run.
 */
export async function enrollContact(input: StartExecutionInput): Promise<EnrollOutcome> {
  const db = getAdminDb();
  const { agencyId, subAccountId, automation, contactId } = input;

  const firstStepDelay = computeFirstStepDelay(automation);
  if (firstStepDelay === null) return "no_steps";

  const ref = db
    .collection("automation_executions")
    .doc(`${automation.id}_${contactId}`);
  const baseExecution: Omit<ExecutionDoc, "id"> = {
    agencyId,
    subAccountId,
    automationId: automation.id,
    contactId,
    status: "running",
    currentStepIndex: 0,
    nextStepDueAt: null,
    qstashMessageId: null,
    history: [],
    startedAt: FieldValue.serverTimestamp() as unknown as null,
    completedAt: null,
    stoppedReason: null,
  };

  try {
    await ref.create({ id: ref.id, ...baseExecution });
  } catch (err) {
    if ((err as { code?: number }).code === 6) return "already_enrolled";
    console.error("[enrollContact] create failed", err);
    return "failed";
  }

  if (!qstashIsConfigured()) {
    console.warn("[enrollContact] QStash not configured — enrollment created but not scheduled.");
    await ref.update({ status: "failed", stoppedReason: "automation_disabled" });
    return "failed";
  }

  const result = await publishStep({
    executionId: ref.id,
    stepIndex: 0,
    delaySeconds: firstStepDelay,
  });
  if (!result) {
    await ref.update({ status: "failed", stoppedReason: "automation_disabled" });
    return "failed";
  }
  await ref.update({ qstashMessageId: result.messageId });

  try {
    await db.collection("contacts").doc(contactId).collection("activities").add({
      type: "automation_started",
      content: `Automation "${automation.name}" started.`,
      createdBy: "automation",
      meta: { automationId: automation.id, executionId: ref.id },
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn("[enrollContact] activity write failed", err);
  }
  return "enrolled";
}
```

- [ ] **Step 4: Gates + commit**

Run: `pnpm test sequence-engine` → 4 passed; then `pnpm exec tsc --noEmit && pnpm test` (full).

```bash
git add src/lib/automations src/lib/automations/__tests__/sequence-engine.test.ts
git commit -m "feat(sequences): outbound_sequence planning + idempotent enrollContact"
```

---

### Task 4: `tag_added` triggers — matching + fire helper

**Files:**
- Modify: `src/lib/automations/triggers.ts` (context + filter)
- Create: `src/lib/automations/tag-triggers.ts`
- Test: `src/lib/automations/__tests__/tag-triggers.test.ts`

**Interfaces:**
- Consumes: `fireTriggers` internals, `enrollContact` (Task 3).
- Produces:
  ```ts
  // triggers.ts: FireTriggersInput.context becomes { formId?: string; tag?: string }
  // tag-triggers.ts:
  export async function fireTagAddedTriggers(input: {
    agencyId: string; subAccountId: string; contactId: string; addedTags: string[];
  }): Promise<void>  // never throws; fires fireTriggers once per unique tag
  ```
- Inside `fireTriggers`: `tag_added` automations match only when `automation.trigger.tag === input.context.tag`; matched `outbound_sequence` automations enroll via `enrollContact` (idempotent) instead of `startExecution`.

- [ ] **Step 1: Failing tests**

`src/lib/automations/__tests__/tag-triggers.test.ts` (same mock preamble as Task 3's test — `@/lib/firebase/admin` + `@/lib/automations/qstash` mocks, `resetFakeDb`/`publishStepMock.mockClear()` in `beforeEach`):

```ts
import { fireTagAddedTriggers } from "@/lib/automations/tag-triggers";

function seedSequenceAutomation(id: string, tag: string) {
  fakeDb.doc(`automations/${id}`).set({
    id, agencyId: "ag1", subAccountId: "subMain",
    recipeType: "outbound_sequence", name: `seq-${id}`, enabled: true,
    trigger: { type: "tag_added", formId: null, tag },
    config: { steps: [{ channel: "email", templateId: "t1", delaySeconds: 0 }] },
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
    await fireTagAddedTriggers({ agencyId: "ag1", subAccountId: "subMain", contactId: "c1", addedTags: ["box1"] });
    expect((await fakeDb.doc("automation_executions/autoA_c1").get()).exists).toBe(true);
    expect((await fakeDb.doc("automation_executions/autoB_c1").get()).exists).toBe(false);
  });

  it("is idempotent across repeated fires and skips paused sub-accounts", async () => {
    seedSequenceAutomation("autoA", "box1");
    await fireTagAddedTriggers({ agencyId: "ag1", subAccountId: "subMain", contactId: "c1", addedTags: ["box1", "box1"] });
    publishStepMock.mockClear();
    await fireTagAddedTriggers({ agencyId: "ag1", subAccountId: "subMain", contactId: "c1", addedTags: ["box1"] });
    expect(publishStepMock).not.toHaveBeenCalled();

    fakeDb.doc("subAccounts/subMain").set({ agencyId: "ag1", automationsPaused: true });
    await fireTagAddedTriggers({ agencyId: "ag1", subAccountId: "subMain", contactId: "c2", addedTags: ["box1"] });
    expect((await fakeDb.doc("automation_executions/autoA_c2").get()).exists).toBe(false);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement**

In `triggers.ts`: change `context: { formId?: string }` to `context: { formId?: string; tag?: string }` and extend the per-match filter block inside `fireTriggers`:

```ts
      // Trigger-specific filters: form_submit must match the formId.
      if (automation.trigger.type === "form_submit") {
        if (
          automation.trigger.formId &&
          automation.trigger.formId !== input.context.formId
        ) {
          continue;
        }
      }
      if (automation.trigger.type === "tag_added") {
        if (!automation.trigger.tag || automation.trigger.tag !== input.context.tag) {
          continue;
        }
      }

      if (automation.recipeType === "outbound_sequence") {
        // Once-per-contact-ever enrollment (deterministic execution id).
        await enrollContact({
          agencyId: input.agencyId,
          subAccountId: input.subAccountId,
          automation,
          contactId: input.contactId,
        });
        continue;
      }

      await startExecution({ ... });   // unchanged existing call
```

Create `src/lib/automations/tag-triggers.ts`:

```ts
import "server-only";

import { fireTriggers } from "./triggers";

/**
 * Fire tag_added triggers for every unique tag just added to a contact.
 * Server-side tag-write paths call this (bulk tag, merge, agent API);
 * client-SDK writes (dashboard form, CSV import) are covered by the
 * enroll endpoint's catch-up sync instead. Never throws — enrollment is
 * idempotent, so over-firing is harmless and under-firing is caught up.
 */
export async function fireTagAddedTriggers(input: {
  agencyId: string;
  subAccountId: string;
  contactId: string;
  addedTags: string[];
}): Promise<void> {
  const unique = [...new Set(input.addedTags.map((t) => t.trim()).filter(Boolean))];
  for (const tag of unique) {
    await fireTriggers({
      agencyId: input.agencyId,
      subAccountId: input.subAccountId,
      triggerType: "tag_added",
      contactId: input.contactId,
      context: { tag },
    });
  }
}
```

- [ ] **Step 3: Gates + commit**

`pnpm test tag-triggers` → 2 passed; full `pnpm exec tsc --noEmit && pnpm test`.

```bash
git add src/lib/automations
git commit -m "feat(sequences): tag_added trigger matching + fireTagAddedTriggers helper"
```

---

### Task 5: Wire tag hooks into server-side tag writes

**Files:**
- Modify: `src/app/api/agent/v1/contacts/route.ts` (POST: after create)
- Modify: `src/app/api/agent/v1/contacts/[id]/route.ts` (PATCH: after update, for actually-added tags)
- Modify: `src/app/api/agent/v1/contacts/import/route.ts` (per created row)
- Modify: `src/app/api/contacts/bulk/route.ts` (after the tag batch)
- Modify: `src/app/api/contacts/merge/route.ts` (surviving contact's tags)
- Test: extend `src/app/api/agent/v1/__tests__/contacts.test.ts` + `contact-detail.test.ts`

**Interfaces:**
- Consumes: `fireTagAddedTriggers` (Task 4). Every call is fire-and-forget with its own catch (`.catch(() => {})` is NOT enough — the helper already never throws; just `await` it AFTER the primary write so a trigger problem can't fail the request; wrap in try/catch per call site anyway for safety).

- [ ] **Step 1: Failing tests**

Both agent-route test files already mock `@/lib/firebase/admin`. Add a triggers mock at the top of each (after the existing mocks):

```ts
const fireTagsMock = vi.fn(async () => {});
vi.mock("@/lib/automations/tag-triggers", () => ({
  fireTagAddedTriggers: (args: unknown) => fireTagsMock(args),
}));
```

In `contacts.test.ts` (remember `fireTagsMock.mockClear()` in `beforeEach`):

```ts
it("fires tag_added triggers for tags on create", async () => {
  await POST(post({ subAccountId: "subMain", email: "t@ex.com", tags: ["box1", "warm"] }));
  expect(fireTagsMock).toHaveBeenCalledWith(
    expect.objectContaining({ subAccountId: "subMain", addedTags: ["box1", "warm"] }),
  );
});
```

In `contact-detail.test.ts`:

```ts
it("fires tag_added only for tags actually added by PATCH", async () => {
  // c1 already has ["box1"]
  await PATCH(...patch("c1", { addTags: ["box1", "warm"] }));
  expect(fireTagsMock).toHaveBeenCalledWith(
    expect.objectContaining({ contactId: "c1", addedTags: ["warm"] }),
  );
});
```

Run → FAIL (mock never called).

- [ ] **Step 2: Implement the five call sites**

1. **Agent create** (`contacts/route.ts` POST) — after the transaction returns `{ id }`, before the 201 return:

```ts
const createdTags = (Array.isArray(body.tags) ? body.tags : []).filter(
  (t): t is string => typeof t === "string" && !!t.trim(),
);
if (createdTags.length) {
  try {
    await fireTagAddedTriggers({
      agencyId: access.agencyId,
      subAccountId: access.subAccountId as string,
      contactId: created.id,
      addedTags: createdTags,
    });
  } catch (err) {
    console.warn("[agent contacts] tag triggers failed", err);
  }
}
```

2. **Agent PATCH** (`contacts/[id]/route.ts`) — the tags block already computes `next`; also compute `const actuallyAdded = next.filter((t) => !current.includes(t));` and after `ref.update(update)` fire with `addedTags: actuallyAdded` (same try/catch shape, `agencyId: contact.agencyId as string`, `subAccountId: contact.subAccountId as string`). Only when `actuallyAdded.length > 0`.

3. **Agent import** (`contacts/import/route.ts`) — inside the loop after a successful create (both transactional and phone-only paths), fire with that row's cleaned tags (reuse the same filter as create; the row's tags were already validated/coerced by `buildContactDoc` — recompute the cleaned list locally).

4. **Bulk tag** (`api/contacts/bulk/route.ts`) — after the `action === "tag"` batches commit, before the response: fire per contact:

```ts
for (const id of contactIds) {
  try {
    await fireTagAddedTriggers({ agencyId, subAccountId, contactId: id, addedTags: [trimmed] });
  } catch (err) {
    console.warn("[contacts/bulk] tag triggers failed", err);
  }
}
```

(Over-firing for contacts that already had the tag is safe — enrollment is idempotent, and pre-tagged contacts SHOULD catch up; that's the desired semantics.)

5. **Merge** (`api/contacts/merge/route.ts`) — locate where the surviving contact's merged `tags` array is written; after that write, fire once with the survivor's full tag list (same rationale: idempotent catch-up). If the merge route turns out not to union tags at all, skip with a one-line report note instead of inventing behavior.

- [ ] **Step 3: Gates + commit**

`pnpm exec tsc --noEmit && pnpm test` (full — bulk/merge have no test files; the agent-route tests cover the mock contract).

```bash
git add src/app/api
git commit -m "feat(sequences): fire tag_added triggers from server-side tag writes"
```

---

### Task 6: Agent sequences routes — list + create

**Files:**
- Create: `src/app/api/agent/v1/sequences/route.ts`
- Test: `src/app/api/agent/v1/__tests__/sequences.test.ts`

**Interfaces:**
- Consumes: `requireServiceAuth` (scope `sequences:write`), `agentError`, `withAgentRoute`, fake admin.
- Produces:
  - `GET /api/agent/v1/sequences?subAccountId=` → `{ data: [{ id, name, enabled, trigger, stepCount }] }` (outbound_sequence automations only, limit 100).
  - `POST /api/agent/v1/sequences` body `{ subAccountId, name, tag?, steps: [{ templateId, delaySeconds }], enabled? }` → `201 { data: { id } }`. Validation: 1-10 steps; each `templateId` must exist in the sub-account and be an email template; `delaySeconds` a finite number ≥ 0; `tag` (optional, trimmed, ≤50 chars) makes the trigger `tag_added`, else `manual`. Steps stored with `channel: "email"`.

- [ ] **Step 1: Failing test**

`src/app/api/agent/v1/__tests__/sequences.test.ts` (standard admin mock + key seeding as in Phase 1 tests; key scopes `["sequences:write", "sequences:enroll", "reports:read"]`; seed `message_templates/t1` = `{ subAccountId: "subMain", agencyId: "ag1", type: "email", name: "E1", subject: "S", body: "b {{unsubscribeLink}}" }` and `t-sms` with `type: "sms"`):

```ts
import { GET, POST } from "@/app/api/agent/v1/sequences/route";

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
```

Run → FAIL.

- [ ] **Step 2: Implement `src/app/api/agent/v1/sequences/route.ts`**

```ts
import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import { requireServiceAuth } from "@/lib/auth/require-service-auth";

const MAX_STEPS = 10;

export const GET = withAgentRoute(async (request: Request) => {
  const url = new URL(request.url);
  const subAccountId = url.searchParams.get("subAccountId");
  if (!subAccountId) {
    return agentError("VALIDATION_FAILED", "subAccountId query param is required.", 400);
  }
  const access = await requireServiceAuth(request, { scope: "sequences:write", subAccountId });
  if (access instanceof NextResponse) return access;

  const snap = await getAdminDb()
    .collection("automations")
    .where("subAccountId", "==", subAccountId)
    .where("recipeType", "==", "outbound_sequence")
    .limit(100)
    .get();
  const data = snap.docs.map((d) => {
    const a = d.data();
    return {
      id: d.id,
      name: a.name,
      enabled: a.enabled,
      trigger: a.trigger,
      stepCount: ((a.config as { steps?: unknown[] })?.steps ?? []).length,
    };
  });
  return NextResponse.json({ data });
});

export const POST = withAgentRoute(async (request: Request) => {
  const body = (await request.json().catch(() => null)) as {
    subAccountId?: string;
    name?: string;
    tag?: string;
    enabled?: boolean;
    steps?: { templateId?: string; delaySeconds?: number }[];
  } | null;

  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 200) : "";
  if (!body || typeof body.subAccountId !== "string" || !body.subAccountId || !name) {
    return agentError("VALIDATION_FAILED", "subAccountId and name are required.", 400);
  }
  if (!Array.isArray(body.steps) || body.steps.length === 0 || body.steps.length > MAX_STEPS) {
    return agentError("VALIDATION_FAILED", `steps[] must contain 1-${MAX_STEPS} entries.`, 400);
  }
  for (const s of body.steps) {
    if (
      !s || typeof s.templateId !== "string" || !s.templateId ||
      typeof s.delaySeconds !== "number" || !Number.isFinite(s.delaySeconds) || s.delaySeconds < 0
    ) {
      return agentError("VALIDATION_FAILED", "Each step needs templateId and delaySeconds >= 0.", 400);
    }
  }
  const tag = typeof body.tag === "string" ? body.tag.trim().slice(0, 50) : "";

  const access = await requireServiceAuth(request, {
    scope: "sequences:write",
    subAccountId: body.subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const db = getAdminDb();
  // Validate every template: exists, same sub-account, email type.
  for (const s of body.steps) {
    const t = await db.doc(`message_templates/${s.templateId}`).get();
    const td = t.data();
    if (!t.exists || td?.subAccountId !== access.subAccountId) {
      return agentError("VALIDATION_FAILED", `Template ${s.templateId} not found in this sub-account.`, 400);
    }
    if (td?.type !== "email") {
      return agentError("VALIDATION_FAILED", `Template ${s.templateId} is not an email template (sequences are email-only in v1).`, 400);
    }
  }

  const ref = db.collection("automations").doc();
  await ref.set({
    id: ref.id,
    agencyId: access.agencyId,
    subAccountId: access.subAccountId,
    recipeType: "outbound_sequence",
    name,
    enabled: body.enabled !== false,
    trigger: tag
      ? { type: "tag_added", formId: null, tag }
      : { type: "manual", formId: null, tag: null },
    config: {
      steps: body.steps.map((s) => ({
        channel: "email",
        templateId: s.templateId as string,
        delaySeconds: Math.floor(s.delaySeconds as number),
      })),
    },
    createdByUid: `agent:${access.keyPrefix}`,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return NextResponse.json({ data: { id: ref.id } }, { status: 201 });
});
```

Note: the composite query (subAccountId + recipeType) may need a Firestore index on first live use — record the console link in Task 13.

- [ ] **Step 3: Gates + commit**

`pnpm test __tests__/sequences` → 3 passed; full gates.

```bash
git add src/app/api/agent/v1/sequences src/app/api/agent/v1/__tests__/sequences.test.ts
git commit -m "feat(agent-api): sequence list/create routes"
```

---

### Task 7: Enroll / unenroll / status routes (confirm gate + caps + catch-up)

**Files:**
- Create: `src/app/api/agent/v1/sequences/[id]/enroll/route.ts`
- Create: `src/app/api/agent/v1/sequences/[id]/unenroll/route.ts`
- Create: `src/app/api/agent/v1/sequences/[id]/status/route.ts`
- Modify: `src/lib/agent-api/caps.ts` (cap union + units)
- Test: `src/app/api/agent/v1/__tests__/sequences-enroll.test.ts`

**Interfaces:**
- Consumes: `enrollContact` (Task 3 — mock `@/lib/automations/qstash` in tests as before), `enforceDailyCap`, `withIdempotency` (scope `"sequences:enroll"`), `requireServiceAuth`, `withAgentRoute`.
- Produces:
  - `caps.ts`: `enforceDailyCap(keyId, cap: "sends" | "enrollments", limit, units = 1)` — transaction adds `units`; blocks when `current + units > limit`.
  - `POST /sequences/[id]/enroll` (scope `sequences:enroll`) body `{ contactIds?: string[], tag?: string, confirm?: { expectedCount, summary } }` — exactly one of contactIds/tag. Resolve audience: ids → validate each contact exists in the sequence's sub-account (invalid ids are skipped with reasons, but still count toward the audience for confirm purposes — confirm compares against the REQUESTED audience size: `contactIds.length` or tag-match count); tag → query contacts `array-contains` tag in sub-account, limit 200. Audience >200 by ids → 400. Missing/mismatched confirm → 409 `CONFIRM_MISMATCH` with `details: { expectedCount, actualCount }`. Daily cap: `units = audience.length`. Response `201 { data: { enrolled, alreadyEnrolled, skipped: [{ contactId, reason }] } }` (reasons: `not_found`, `no_steps`, `failed`). The idempotent `enrollContact` makes re-running the same call a clean catch-up sync (`alreadyEnrolled` grows, `enrolled` covers only new contacts).
  - `POST /sequences/[id]/unenroll` (scope `sequences:enroll`) body `{ contactIds: string[] }` (1-200) → stops each RUNNING execution `${id}_${contactId}` with `stoppedReason: "manual"`; response `{ data: { stopped, notRunning } }`.
  - `GET /sequences/[id]/status` (scope `reports:read`) → `{ data: { sequence: { id, name, enabled }, counts: { running, completed, stopped, failed }, stoppedReasons: { replied: n, manual: n, ... } } }` from executions `where("automationId", "==", id)` (limit 5000, `.select("status","stoppedReason")`).

- [ ] **Step 1: Failing tests** — `sequences-enroll.test.ts` (admin + qstash mocks; seed key with `sequences:enroll`+`reports:read`, sequence automation doc `automations/seq1` shaped as in Task 4's seeder but trigger `manual`, and contacts `c1..c3` in `subMain` with `tags: ["box1"]` on c1/c2):

```ts
import { POST as ENROLL } from "@/app/api/agent/v1/sequences/[id]/enroll/route";
import { POST as UNENROLL } from "@/app/api/agent/v1/sequences/[id]/unenroll/route";
import { GET as STATUS } from "@/app/api/agent/v1/sequences/[id]/status/route";

const ctx = { params: Promise.resolve({ id: "seq1" }) };

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
```

Run → FAIL.

- [ ] **Step 2: Widen `caps.ts`**

```ts
export async function enforceDailyCap(
  keyId: string,
  cap: "sends" | "enrollments",
  limit: number,
  units = 1,
): Promise<NextResponse | null> {
  // transaction body: const current = ...; if (current + units > limit) throw; tx.set(ref, { [cap]: current + units }, { merge: true });
```

(Existing "sends" callers unchanged — default `units = 1`. Keep the 429 details/Retry-After exactly as-is, message: `Daily ${cap} cap of ${limit} reached for this key.`)

- [ ] **Step 3: Implement the three routes**

`enroll/route.ts`:

```ts
import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { enforceDailyCap } from "@/lib/agent-api/caps";
import { withIdempotency } from "@/lib/agent-api/idempotency";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import { requireServiceAuth, subAccountAllowed } from "@/lib/auth/require-service-auth";
import { enrollContact } from "@/lib/automations/triggers";
import type { AutomationDoc } from "@/types";

const MAX_BATCH = 200;
const DAILY_ENROLL_CAP = 500;

export const POST = withAgentRoute<{ params: Promise<{ id: string }> }>(
  async (request, ctx) => {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as {
      contactIds?: string[];
      tag?: string;
      confirm?: { expectedCount?: number; summary?: string };
    } | null;
    if (!body) return agentError("VALIDATION_FAILED", "Invalid JSON body.", 400);

    const hasIds = Array.isArray(body.contactIds) && body.contactIds.length > 0;
    const tag = typeof body.tag === "string" ? body.tag.trim() : "";
    if (hasIds === !!tag) {
      return agentError("VALIDATION_FAILED", "Provide exactly one of contactIds[] or tag.", 400);
    }
    if (hasIds && (body.contactIds as string[]).length > MAX_BATCH) {
      return agentError("VALIDATION_FAILED", `Max ${MAX_BATCH} contacts per enroll call.`, 400);
    }
    if (hasIds && (body.contactIds as string[]).some((c) => typeof c !== "string" || !c)) {
      return agentError("VALIDATION_FAILED", "contactIds must be non-empty strings.", 400);
    }

    const access = await requireServiceAuth(request, { scope: "sequences:enroll" });
    if (access instanceof NextResponse) return access;

    const db = getAdminDb();
    const autoSnap = await db.doc(`automations/${id}`).get();
    if (!autoSnap.exists) return agentError("NOT_FOUND", "Sequence not found.", 404);
    const automation = autoSnap.data() as AutomationDoc;
    if (!subAccountAllowed(access, automation.subAccountId)) {
      return agentError("NOT_FOUND", "Sequence not found.", 404);
    }
    if (automation.recipeType !== "outbound_sequence") {
      return agentError("VALIDATION_FAILED", "Automation is not an outbound sequence.", 400);
    }
    if (!automation.enabled) {
      return agentError("VALIDATION_FAILED", "Sequence is disabled.", 400);
    }

    // Resolve the audience.
    let audience: string[];
    if (hasIds) {
      audience = body.contactIds as string[];
    } else {
      const matches = await db
        .collection("contacts")
        .where("subAccountId", "==", automation.subAccountId)
        .where("tags", "array-contains", tag)
        .limit(MAX_BATCH)
        .get();
      audience = matches.docs.map((d) => d.id);
    }

    // Batch-approval gate: Star approves a campaign of N; the tool proves N.
    const expected = body.confirm?.expectedCount;
    if (typeof expected !== "number" || expected !== audience.length) {
      return agentError(
        "CONFIRM_MISMATCH",
        "confirm.expectedCount must equal the resolved audience size — re-check the batch with the operator before enrolling.",
        409,
        { expectedCount: expected ?? null, actualCount: audience.length },
      );
    }
    if (audience.length === 0) {
      return NextResponse.json({ data: { enrolled: 0, alreadyEnrolled: 0, skipped: [] } }, { status: 201 });
    }

    const capped = await enforceDailyCap(access.keyId, "enrollments", DAILY_ENROLL_CAP, audience.length);
    if (capped) return capped;

    return withIdempotency(request, access.keyId, "sequences:enroll", async () => {
      let enrolled = 0;
      let alreadyEnrolled = 0;
      const skipped: { contactId: string; reason: string }[] = [];
      for (const contactId of audience) {
        const contactSnap = await db.doc(`contacts/${contactId}`).get();
        if (!contactSnap.exists || contactSnap.data()?.subAccountId !== automation.subAccountId) {
          skipped.push({ contactId, reason: "not_found" });
          continue;
        }
        const outcome = await enrollContact({
          agencyId: automation.agencyId,
          subAccountId: automation.subAccountId,
          automation: { ...automation, id },
          contactId,
        });
        if (outcome === "enrolled") enrolled++;
        else if (outcome === "already_enrolled") alreadyEnrolled++;
        else skipped.push({ contactId, reason: outcome });
      }
      return { status: 201, body: { data: { enrolled, alreadyEnrolled, skipped } } };
    });
  },
);
```

`unenroll/route.ts` (same preamble/auth/sequence-load shape, scope `sequences:enroll`, body `{ contactIds: string[] }` 1-200 validated):

```ts
    let stopped = 0;
    let notRunning = 0;
    for (const contactId of body.contactIds) {
      const ref = db.doc(`automation_executions/${id}_${contactId}`);
      const snap = await ref.get();
      if (!snap.exists || snap.data()?.status !== "running") {
        notRunning++;
        continue;
      }
      await ref.update({
        status: "stopped",
        stoppedReason: "manual",
        completedAt: FieldValue.serverTimestamp(),
      });
      stopped++;
    }
    return NextResponse.json({ data: { stopped, notRunning } });
```

`status/route.ts` (scope `reports:read`; auth without subAccountId then `subAccountAllowed` on the loaded automation → 404 pattern):

```ts
    const snap = await db
      .collection("automation_executions")
      .where("automationId", "==", id)
      .select("status", "stoppedReason")
      .limit(5000)
      .get();
    const counts: Record<string, number> = { running: 0, completed: 0, stopped: 0, failed: 0 };
    const stoppedReasons: Record<string, number> = {};
    for (const d of snap.docs) {
      const s = d.data();
      counts[(s.status as string) ?? "failed"] = (counts[(s.status as string) ?? "failed"] ?? 0) + 1;
      if (s.stoppedReason) {
        stoppedReasons[s.stoppedReason as string] = (stoppedReasons[s.stoppedReason as string] ?? 0) + 1;
      }
    }
    return NextResponse.json({
      data: {
        sequence: { id, name: automation.name, enabled: automation.enabled },
        counts,
        stoppedReasons,
      },
    });
```

- [ ] **Step 4: Gates + commit**

`pnpm test sequences-enroll` → 5 passed; full gates (idempotency test updates from Task 2 already cover the scope change).

```bash
git add src/app/api/agent/v1/sequences src/lib/agent-api/caps.ts src/app/api/agent/v1/__tests__/sequences-enroll.test.ts
git commit -m "feat(agent-api): sequence enroll/unenroll/status with confirm gate + enrollment caps"
```

---

### Task 8: Svix signature verification (pure lib)

**Files:**
- Create: `src/lib/webhooks/svix-verify.ts`
- Test: `src/lib/webhooks/__tests__/svix-verify.test.ts`

**Interfaces:**
- Produces: `verifySvixSignature(input: { secret: string; id: string; timestamp: string; signature: string; body: string; toleranceSeconds?: number }): boolean` — implements the standard Svix scheme Resend uses: secret is `whsec_<base64>`; signed content is `` `${id}.${timestamp}.${body}` ``; HMAC-SHA256 with the base64-decoded secret; result base64-encoded and compared (timing-safe) against the space-separated `v1,<sig>` entries in the signature header; timestamp must be within tolerance (default 300s).

- [ ] **Step 1: Failing test** (self-consistent vector — compute the expected signature with Node crypto inside the test):

```ts
import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySvixSignature } from "@/lib/webhooks/svix-verify";

function sign(secretB64: string, id: string, ts: string, body: string): string {
  return createHmac("sha256", Buffer.from(secretB64, "base64"))
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
}

describe("verifySvixSignature", () => {
  const secretB64 = randomBytes(24).toString("base64");
  const secret = `whsec_${secretB64}`;
  const id = "msg_abc";
  const body = '{"type":"email.received"}';

  it("accepts a valid v1 signature within tolerance", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v1,${sign(secretB64, id, ts, body)}`;
    expect(verifySvixSignature({ secret, id, timestamp: ts, signature: sig, body })).toBe(true);
  });

  it("accepts when a valid sig is one of several space-separated entries", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v1,${Buffer.from("garbage").toString("base64")} v1,${sign(secretB64, id, ts, body)}`;
    expect(verifySvixSignature({ secret, id, timestamp: ts, signature: sig, body })).toBe(true);
  });

  it("rejects wrong secret, tampered body, and stale timestamp", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v1,${sign(secretB64, id, ts, body)}`;
    expect(verifySvixSignature({ secret: "whsec_" + randomBytes(24).toString("base64"), id, timestamp: ts, signature: sig, body })).toBe(false);
    expect(verifySvixSignature({ secret, id, timestamp: ts, signature: sig, body: body + " " })).toBe(false);
    const staleTs = String(Math.floor(Date.now() / 1000) - 3600);
    const staleSig = `v1,${sign(secretB64, id, staleTs, body)}`;
    expect(verifySvixSignature({ secret, id, timestamp: staleTs, signature: staleSig, body })).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Manual verification of Svix-style webhook signatures (used by Resend).
 * Signed content is `${id}.${timestamp}.${body}` HMAC-SHA256'd with the
 * base64-decoded portion of the `whsec_…` secret; the header carries one
 * or more space-separated `v1,<base64sig>` entries. No svix dependency.
 */
export function verifySvixSignature(input: {
  secret: string;
  id: string;
  timestamp: string;
  signature: string;
  body: string;
  toleranceSeconds?: number;
}): boolean {
  const tolerance = input.toleranceSeconds ?? 300;
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > tolerance) return false;

  const secretB64 = input.secret.startsWith("whsec_")
    ? input.secret.slice("whsec_".length)
    : input.secret;
  let key: Buffer;
  try {
    key = Buffer.from(secretB64, "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const expected = createHmac("sha256", key)
    .update(`${input.id}.${input.timestamp}.${input.body}`)
    .digest();

  for (const part of input.signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 3: Gates + commit**

`pnpm test svix-verify` → 3 passed; full gates.

```bash
git add src/lib/webhooks
git commit -m "feat(webhooks): manual svix signature verification (no new dependency)"
```

---

### Task 9: Resend inbound webhook — ingest, stop-on-reply, forward

**Files:**
- Create: `src/app/api/webhooks/resend-inbound/route.ts`
- Modify: `src/middleware.ts` (PUBLIC_PATHS: add `"/api/webhooks/resend-inbound",` after the twilio entry — note `"/api/webhooks/twilio"` uses prefix matching; our path needs its own entry)
- Test: `src/app/api/webhooks/__tests__/resend-inbound.test.ts`

**Interfaces:**
- Consumes: `verifySvixSignature` (Task 8), fake admin, `sendEmail`/`emailIsConfigured` (mock).
- Produces: `POST /api/webhooks/resend-inbound` — behavior:
  1. 503 if `RESEND_INBOUND_WEBHOOK_SECRET` unset (webhook configured in Resend but not in env — surface loudly).
  2. Verify svix headers against the RAW body text → 401 on failure.
  3. Ignore (200 `{ ok: true, ignored: true }`) any event whose `type !== "email.received"`.
  4. Parse defensively: `data.from` may be `"Name <a@b.c>"` or `{ email, name }` or plain address; `data.to` may be string or array (elements same shapes). `data.text`/`data.html`/`data.subject` may be absent. Never throw on shape surprises — log and store what parsed.
  5. Match contact: first `to` address matching `/^reply\+([A-Za-z0-9]+)@/i` → contactId (`matchedBy: "reply_token"`); verify the contact exists. Fallback: `contacts where email == fromEmail limit 2` — exactly one hit → match (`matchedBy: "email_lookup"`); zero or ambiguous → unmatched.
  6. Always store an `inbound_emails` doc (dedupe: doc id = `data.email_id` when present, `set(..., { merge: false })` is fine — replays overwrite identically; else auto-id).
  7. If matched: write `email_reply` activity (`createdBy: "webhook:resend"`, content `Reply received: <subject>`); stop every RUNNING execution for the contact whose automation is an `outbound_sequence` (query executions `where contactId == X where status == "running"`, load each automation, filter recipeType) → update `status: "stopped", stoppedReason: "replied", completedAt` + one activity `Sequence "<name>" stopped — contact replied.`; forward a copy via `sendEmail({ to: subAccount.replyToEmail, subject: "[Reply] " + subject, text: ... })` when `emailIsConfigured()` and `replyToEmail` is set (wrap in try/catch — forwarding failure must not fail ingestion).
  8. Return 200 `{ ok: true, matched: <bool> }`.

- [ ] **Step 1: Failing tests** — `resend-inbound.test.ts`. Mock preamble: admin fake; `vi.mock("@/lib/comms/resend", ...)` with `sendEmailMock` + `emailIsConfigured: () => true`; set `process.env.RESEND_INBOUND_WEBHOOK_SECRET = "whsec_" + randomBytes(24).toString("base64")` in `beforeEach` (and keep the base64 part to sign with). Helper `signedRequest(eventBody: unknown)` builds the raw JSON string, computes svix headers with the same HMAC as Task 8's test helper, and returns the `Request`. Seed: `subAccounts/subMain` `{ agencyId: "ag1", replyToEmail: "star@myusa.com" }`; contact `c1` `{ email: "prospect@ex.com", subAccountId: "subMain", agencyId: "ag1", name: "Pat", tags: [] }`; automations `seq1` (outbound_sequence, name "Box1") + `nurt1` (lead_nurture); executions `automation_executions/seq1_c1` `{ automationId: "seq1", contactId: "c1", status: "running", subAccountId: "subMain", agencyId: "ag1", history: [] }` and `automation_executions/nurtX` `{ automationId: "nurt1", contactId: "c1", status: "running", ... }`.

Cases:

```ts
it("401s on a bad signature and 503s when the secret is unset", async () => { ... });

it("ingests a reply matched by plus-token, stops only the outbound sequence, forwards a copy", async () => {
  const res = await POST(signedRequest({
    type: "email.received",
    data: {
      email_id: "re_123",
      from: "Pat Prospect <prospect@ex.com>",
      to: ["reply+c1@hey.ugotleads.io"],
      subject: "Re: Quick question",
      text: "Sounds interesting, call me",
    },
  }));
  expect(res.status).toBe(200);
  expect((await res.json()).matched).toBe(true);
  const inbound = (await fakeDb.doc("inbound_emails/re_123").get()).data()!;
  expect(inbound).toMatchObject({ contactId: "c1", matchedBy: "reply_token", handled: false, subAccountId: "subMain" });
  expect((await fakeDb.doc("automation_executions/seq1_c1").get()).data()).toMatchObject({ status: "stopped", stoppedReason: "replied" });
  expect((await fakeDb.doc("automation_executions/nurtX").get()).data()?.status).toBe("running");
  const acts = await fakeDb.collection("contacts/c1/activities").get();
  expect(acts.docs.some((d) => d.data()?.type === "email_reply")).toBe(true);
  expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: "star@myusa.com" }));
});

it("falls back to unique from-email lookup and stores unmatched replies", async () => {
  // to-address without token, from matches c1's email uniquely → matchedBy email_lookup
  // then a second event from unknown@nowhere.com → stored with contactId null, still 200
});

it("ignores non-received event types", async () => { ... 200 ignored:true, nothing stored ... });

it("never throws on malformed data shapes", async () => {
  const res = await POST(signedRequest({ type: "email.received", data: { from: { email: "prospect@ex.com" }, to: "reply+c1@hey.ugotleads.io", subject: null } }));
  expect(res.status).toBe(200);
});
```

Run → FAIL.

- [ ] **Step 2: Implement the route** — key parsing helpers inside the file:

```ts
function extractEmail(v: unknown): string {
  if (typeof v === "string") {
    const m = /<([^>]+)>/.exec(v);
    return (m ? m[1] : v).trim().toLowerCase();
  }
  if (v && typeof v === "object" && typeof (v as { email?: unknown }).email === "string") {
    return ((v as { email: string }).email).trim().toLowerCase();
  }
  return "";
}

function extractAddresses(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(extractEmail).filter(Boolean);
  const one = extractEmail(v);
  return one ? [one] : [];
}
```

Route skeleton (full implementation follows the behavior contract above; structure):

```ts
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[resend-inbound] RESEND_INBOUND_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  const rawBody = await request.text();
  const ok = verifySvixSignature({
    secret,
    id: request.headers.get("svix-id") ?? "",
    timestamp: request.headers.get("svix-timestamp") ?? "",
    signature: request.headers.get("svix-signature") ?? "",
    body: rawBody,
  });
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  let event: { type?: string; data?: Record<string, unknown> };
  try { event = JSON.parse(rawBody); } catch { return NextResponse.json({ ok: true, ignored: true }); }
  if (event.type !== "email.received" || !event.data) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  // ...parse, match (token → fallback), store inbound_emails, stop
  // outbound_sequence executions, activity, forward — per the contract.
  // Wrap everything after signature verification in try/catch → on error
  // log + return 200 { ok: false } (Resend must not retry forever on our bugs).
}
```

Stop-on-reply block (inside the matched branch):

```ts
  const running = await db
    .collection("automation_executions")
    .where("contactId", "==", contact.id)
    .where("status", "==", "running")
    .limit(50)
    .get();
  for (const ex of running.docs) {
    const autoSnap = await db.doc(`automations/${ex.data().automationId as string}`).get();
    const auto = autoSnap.data();
    if (auto?.recipeType !== "outbound_sequence") continue;
    await ex.ref.update({
      status: "stopped",
      stoppedReason: "replied",
      completedAt: FieldValue.serverTimestamp(),
    });
    await db.collection(`contacts/${contact.id}/activities`).add({
      type: "automation_completed",
      content: `Sequence "${auto?.name ?? "sequence"}" stopped — contact replied.`,
      createdBy: "webhook:resend",
      meta: { automationId: ex.data().automationId, executionId: ex.id, stoppedReason: "replied" },
      createdAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
  }
```

Add the middleware PUBLIC_PATHS entry with a comment mirroring the QStash ones: signature-verified inside the route.

- [ ] **Step 3: Gates + commit**

`pnpm test resend-inbound` → 5 passed; full gates.

```bash
git add src/app/api/webhooks/resend-inbound src/middleware.ts src/app/api/webhooks/__tests__
git commit -m "feat(sequences): resend inbound webhook — reply ingestion, stop-on-reply, human forward"
```

---

### Task 10: Sequence reply-to routing in the executor

**Files:**
- Create: `src/lib/automations/sequence-reply-to.ts`
- Modify: `src/lib/automations/executor.ts:317-320` (replyTo resolution)
- Test: `src/lib/automations/__tests__/sequence-reply-to.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function resolveSequenceReplyTo(input: {
    recipeType: RecipeType;
    recipientKind: "contact" | "static";
    contactId: string;
    subAccountReplyTo: string | null | undefined;
    inboundDomain: string | null | undefined; // process.env.INBOUND_REPLY_DOMAIN
  }): string | undefined
  ```
  Rules: static recipient → `undefined`; `outbound_sequence` + inboundDomain set → `` `reply+${contactId}@${inboundDomain}` ``; otherwise `subAccountReplyTo ?? undefined`.

- [ ] **Step 1: Failing test** — four cases (sequence with domain → plus address; sequence without domain → falls back to replyToEmail; nurture with domain set → still replyToEmail, NOT plus-addressed; static recipient → undefined).

- [ ] **Step 2: Implement the pure function**, then replace the executor's inline `replyTo` ternary (executor.ts:317-320) with:

```ts
      const replyTo = resolveSequenceReplyTo({
        recipeType: automation.recipeType,
        recipientKind: step.recipient.kind,
        contactId: contact.id,
        subAccountReplyTo: subAccount?.replyToEmail ?? null,
        inboundDomain: process.env.INBOUND_REPLY_DOMAIN ?? null,
      });
```

(import at top; behavior for existing recipes is byte-identical to today.)

- [ ] **Step 3: Gates + commit**

```bash
git add src/lib/automations
git commit -m "feat(sequences): plus-addressed reply-to for outbound sequence sends"
```

---

### Task 11: Agent replies routes

**Files:**
- Create: `src/app/api/agent/v1/replies/route.ts` (GET)
- Create: `src/app/api/agent/v1/replies/[id]/route.ts` (PATCH)
- Test: `src/app/api/agent/v1/__tests__/replies.test.ts`

**Interfaces:**
- Consumes: `requireServiceAuth` (scopes `replies:read` / `replies:write`), `withAgentRoute`, `subAccountAllowed`.
- Produces:
  - `GET /api/agent/v1/replies?subAccountId=&handled=false&limit=` → `{ data: [{ id, contactId, fromEmail, subject, text, handled, matchedBy, receivedAt }] }` — query `inbound_emails where subAccountId == X` plus `where handled == false` when `handled=false` passed; limit clamp 1-100 default 20.
  - `PATCH /api/agent/v1/replies/[id]` body `{ handled: boolean }` → foreign/missing → 404 (Phase 1 tenancy convention); response `{ data: { id, handled } }`.

- [ ] **Step 1: Failing tests** — seed two inbound docs (one handled) for subMain + one for subOther; assert list filtering, the handled=false filter, foreign-tenant PATCH → 404, happy PATCH flips the flag in fakeDb.

- [ ] **Step 2: Implement** both routes following the exact Phase 1 patterns (GET mirrors `templates` GET; PATCH mirrors the `loadAuthorized*` + 404 convention; validate `typeof body.handled === "boolean"` else 400).

- [ ] **Step 3: Gates + commit**

```bash
git add src/app/api/agent/v1/replies src/app/api/agent/v1/__tests__/replies.test.ts
git commit -m "feat(agent-api): replies list + mark-handled routes"
```

---

### Task 12: Phase 1 hardening batch (final-review follow-ups)

**Files:**
- Modify: `src/lib/agent-api/contact-defaults.ts`, `src/app/api/agent/v1/contacts/route.ts`, `contacts/[id]/route.ts`, `contacts/import/route.ts`, `templates/route.ts`, `messages/email/route.ts`, `scripts/mint-service-key.mjs`
- Test: extend the corresponding `__tests__` files + `src/app/api/agency/__tests__/service-keys.test.ts`

Each item is small; one commit for the batch. Apply exactly:

- [ ] **1. `pipelineStage` validated on create/import** — in `contacts/route.ts` POST and `contacts/import/route.ts` (per row): if `pipelineStage` is present and not one of `PIPELINE_STAGES.map(s => s.id)` → POST returns 400 `VALIDATION_FAILED`; import skips the row with reason `"invalid_pipeline_stage"`. Test each.
- [ ] **2. Contact PATCH email dedupe** — in `contacts/[id]/route.ts` PATCH: when `body.email` is a valid non-empty string that differs from the current email, query `contacts where subAccountId == contact.subAccountId where email == newEmail limit 1`; a hit that isn't this contact → 409 `VALIDATION_FAILED` with `details.existingId`. Also: clearing email (`email: ""`) is rejected with 400 when the contact has no phone (preserves the email-or-phone invariant). Tests for both.
- [ ] **3. Foreign-tenant 404 tests for deals/templates/email** — add one test each to `deals.test.ts`, `templates.test.ts`, `messages-email.test.ts`: seed a doc in `subOther`, hit the `[id]`/send route with the subMain key → expect 404 (`NOT_FOUND`), not 403.
- [ ] **4. `readAgencyOwner` auth-branch tests** — in `service-keys.test.ts`: request without `x-user-uid` → 401; uid whose `getUser` mock rejects → 401.
- [ ] **5. Templates GET `type` validation** — in `templates/route.ts` GET: `type` present but not `"email"`/`"sms"` → 400. One test.
- [ ] **6. Length caps** — `templates` POST/PATCH: name ≤ 200, subject ≤ 300, body ≤ 100_000 chars → 400 beyond. `messages/email`: subject ≤ 300, body ≤ 100_000 → 400. Named constants at top of each file. One boundary test per route (use `"x".repeat(N+1)`).
- [ ] **7. Mint-script scope validation** — `scripts/mint-service-key.mjs`: validate every `--scopes` entry against the literal 11-scope array (copy the list with a comment cross-referencing `src/types/service-keys.ts`); unknown scope → print the offender + valid list, exit 1. (No test — script is a dev utility; verified in Task 13 smoke.)
- [ ] **8. Deal PATCH `value` guard for Infinity** — `deals/[id]/route.ts`: the value update condition becomes `typeof body.value === "number" && Number.isFinite(body.value) && body.value >= 0` (matches reports). Same for `deals/route.ts` POST.

- [ ] **Gates + commit**

`pnpm exec tsc --noEmit && pnpm test` (full).

```bash
git add src scripts
git commit -m "fix(agent-api): phase 1 hardening batch — validation, dedupe, tenancy tests, caps"
```

---

### Task 13: Full verification, operator setup guide, smoke, docs

**Files:**
- Modify: `docs/AGENT_API.md` (sequences/enroll/status/replies sections + webhook + env vars)
- Create: `docs/OUTBOUND_SEQUENCES.md` (operator guide)
- No other source changes expected.

- [ ] **Step 1: Gates**

```bash
pnpm test && pnpm exec tsc --noEmit && pnpm lint && pnpm build
```

Expected: all green (lint: 0 errors, ~220 baseline warnings; build compiles the new routes — check the route manifest lists `/api/agent/v1/sequences`, `/api/webhooks/resend-inbound`, etc.).

- [ ] **Step 2: Local smoke (no external config needed)**

Copy `.env.local` from the main checkout. Add locally (NOT committed): `RESEND_INBOUND_WEBHOOK_SECRET=whsec_<generate: node -e "console.log(require('crypto').randomBytes(24).toString('base64'))">` and `INBOUND_REPLY_DOMAIN=hey.ugotleads.io`. Run `pnpm dev`, then with a fresh smoke key (mint via script, scopes `sequences:write,sequences:enroll,reports:read,contacts:write,contacts:read,templates:write,templates:read`):

1. Create an email template + a sequence with 2 steps (day 0 / day 4) via curl → 201s.
2. Create a throwaway contact tagged `bridge-smoke-2`.
3. Enroll by tag WITHOUT confirm → expect 409 CONFIRM_MISMATCH (the governance gate works).
4. Enroll with `confirm: { expectedCount: 1, summary: "smoke" }` → 201, `enrolled: 1`. **Immediately** unenroll (stops the QStash-scheduled step 0 from actually sending — but note: step 0 with delay 0 may already have fired against LOCALHOST's QStash... QStash is configured with the prod `NEXT_PUBLIC_APP_URL`, so the callback goes to PROD, where the execution doc doesn't exist → executor logs "not found" and ignores. Safe, but note it in the report). Safer: create the smoke sequence with step-0 delay of 3600s so nothing can send, then unenroll.
5. Simulate an inbound reply with a locally-signed webhook POST (sign with your local secret, `to: ["reply+<contactId>@hey.ugotleads.io"]`) → 200 matched, execution stopped `replied`, reply listed via `GET /replies`, `PATCH` marks handled.
6. Re-enroll the same contact → `alreadyEnrolled: 1` (idempotency-forever survives the stop).
7. Cleanup via the Task 14 Phase-1 pattern (Admin-SDK script in scratch): delete the smoke contact (recursiveDelete), the smoke sequence automation, its execution doc, the inbound_emails doc, the smoke template, and revoke the smoke key. Verify each gone.

Record any Firestore composite-index prompts (the `subAccountId+recipeType` and `contactId+status` queries are candidates) — click the console links to create them and list them in the report; they're needed in prod too.

- [ ] **Step 3: Docs**

`docs/AGENT_API.md`: add Sequences (create/list/enroll/unenroll/status with the confirm-gate contract and cap values), Replies (GET/PATCH), the `email_reply`/stop-on-reply behavior, new env vars, and the two new error situations (`CONFIRM_MISMATCH` on enroll; 503 on unconfigured webhook).

`docs/OUTBOUND_SEQUENCES.md` (operator guide, mentor voice, step-by-step):
1. **Resend inbound setup** (one-time): Resend dashboard → Domains → hey.ugotleads.io → enable receiving → add the MX record Resend displays at Namecheap (the dashboard shows exact host/value/priority — copy verbatim; DNS propagation up to 1h). Then Webhooks → Add → endpoint `https://app.ugotleads.io/api/webhooks/resend-inbound`, event `email.received` → copy the signing secret.
2. **Vercel env vars** (Production): `RESEND_INBOUND_WEBHOOK_SECRET=whsec_…`, `INBOUND_REPLY_DOMAIN=hey.ugotleads.io` → redeploy. (Per the automation rules: env vars in the production dashboard are the #1 deploy-failure cause — do this BEFORE relying on stop-on-reply.)
3. **How a campaign runs**: create templates → create sequence (tag `box1`) → import/tag contacts → agent proposes the batch → you approve the count → enroll → replies stop sequences automatically and appear in `/replies` + your inbox.
4. **Kill switches**: disable the sequence (automations page or API), `automationsPaused` on the sub-account, unenroll, unsubscribe links (always present).
5. **What still needs Phase 3**: the `/outreach` orchestrator + MCP tools; until then Claude drives via curl/scripts.

- [ ] **Step 4: Commit**

```bash
git add docs/AGENT_API.md docs/OUTBOUND_SEQUENCES.md
git commit -m "docs: sequences + replies API reference and operator setup guide"
```

- [ ] **Step 5: Report to Star** — branch, test counts, smoke evidence, index links created, and the explicit reminder: **deploy + Resend/Vercel setup are her actions** (PAUSE tier); until the env vars are set in prod, sequences send with the old reply-to and stop-on-reply is inert (everything else works).

---

## Self-Review Notes (already applied)

- **Spec coverage:** 4.3 triggers/recipe/stop-reason → Tasks 1, 3, 4, 5; idempotent enrollment + catch-up sync → Tasks 3, 7; 4.4 reply ingestion/stop-on-reply → Tasks 8, 9, 10; spec 4.2 sequences/replies rows → Tasks 6, 7, 11; batch-approval enforcement (spec §5 hard gate) → Task 7's CONFIRM_MISMATCH; per-key caps (spec §6) → Task 7; Phase 1 final-review follow-ups → Tasks 2, 12.
- **Deviations (documented):** reply-to strategy resolved as plus-addressing + human forward (spec left it to phase-2 planning); `tag_added` firing includes merge + bulk over-firing by design (idempotency makes it safe); sequence create caps steps at 10; SMS steps excluded (A2P). Dashboard UI for sequences is deliberately absent — agent-API-only until operators need it (Phase 4 dogfood will tell).
- **Type consistency:** `enrollContact` consumes `StartExecutionInput` (existing interface, unexported — export it or inline the shape; Task 3's implementer should export it alongside `enrollContact`); `EnrollOutcome` strings match Task 7's skip reasons; `withIdempotency` scope param signature matches Tasks 2 and 7 call sites; `verifySvixSignature` input shape matches Task 9's call; `resolveSequenceReplyTo` matches the executor call in Task 10; fake `create()` code-6 contract matches `enrollContact`'s catch.
- **Regression safety:** `planSteps`/`computeFirstStepDelay` changes are additive switch cases; executor reply-to refactor is behavior-identical for existing recipes (Task 10 tests assert it); `withIdempotency` scope param touches four existing call sites whose tests run in every task's full-suite gate.
