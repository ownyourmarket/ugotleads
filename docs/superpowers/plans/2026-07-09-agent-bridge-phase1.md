# Agent Bridge Phase 1 — Service Auth + Core Agent API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give external agents (the MyUSA Suit) an authenticated HTTP surface into UGotLeads: service-key auth + `/api/agent/v1/*` routes for contacts, deals, templates, one-off email sends, and reports.

**Architecture:** A `Bearer ugl_<hex>` service key (SHA-256 hashed in Firestore `agencyServiceKeys`) is validated by a new `requireServiceAuth()` guard modeled on `require-tenancy.ts`. Agent routes live under `/api/agent/v1/`, bypass session middleware via `PUBLIC_PATHS` (the QStash-callback pattern), and use the Firebase Admin SDK for all reads/writes so opt-out flags, activity logging, and validation are enforced server-side.

**Tech Stack:** Next.js 15.5 App Router (route handlers, async `ctx.params`), Firebase Admin SDK (`getAdminDb`/`getAdminAuth` from `@/lib/firebase/admin`), Resend via `@/lib/comms/resend`, Vitest (new — repo has no test framework yet), pnpm.

**Spec:** `docs/AGENT_BRIDGE_SPEC.md` sections 4.1, 4.2, 6, 7, 8. Sequences/enroll and replies routes are **Phase 2** — do not build them here.

## Global Constraints

- Package manager is **pnpm** (`pnpm-lock.yaml`). Never run `npm install`.
- Repo conventions: `import "server-only";` first line of server-only modules; 2-space indent; Prettier (`pnpm format`); path alias `@/*` → `./src/*`.
- Next 15 dynamic routes receive `ctx: { params: Promise<{ id: string }> }` — always `await ctx.params`.
- Agent API response envelope: success `{ data: ... }`, failure `{ error: { code, message, details? } }`. Never return bare strings or expose stack traces.
- Service key format: `ugl_` + 40 lowercase hex chars. `keyPrefix` = first 8 chars of the full key (e.g. `ugl_a1b2`). All agent-created docs stamp `createdByUid`/`createdBy` = `agent:<keyPrefix>`.
- Caps (Phase 1): max **100 one-off email sends per key per UTC day**; max **200 rows per import call**; search `limit` max 100 (default 20).
- Scopes (exact strings): `contacts:read`, `contacts:write`, `deals:write`, `templates:read`, `templates:write`, `sends:execute`, `reports:read`, plus Phase-2 reserved: `sequences:write`, `sequences:enroll`, `replies:read`, `replies:write`.
- **Do NOT deploy.** Local dev + tests only. Deploying to Vercel is a separate approval (governance PAUSE tier).
- SMS one-off route is deferred until Twilio A2P approval lands (documented deviation — `smsIsConfigured()` is false in prod anyway).
- No new env vars are needed; agent routes reuse the existing `FIREBASE_ADMIN_*`, `RESEND_API_KEY`, `EMAIL_FROM`.
- New Firestore collections `agencyServiceKeys` and `agentIdempotency` get **no** `firestore.rules` entries — rules are default-deny, so the client SDK can't touch them; only the Admin SDK can. Verify, don't assume (Task 4 has a check step).

## File Structure

| File | Responsibility |
|---|---|
| `vitest.config.ts` (create) | Test runner config, `@` alias, node env |
| `src/types/service-keys.ts` (create) | `ServiceScope`, `ServiceKeyDoc` |
| `src/lib/agent-api/errors.ts` (create) | `agentError()` typed envelope helper |
| `src/lib/agent-api/keys.ts` (create) | `generateServiceKey()`, `hashServiceKey()` (pure) |
| `src/lib/auth/require-service-auth.ts` (create) | `requireServiceAuth()` guard + `subAccountAllowed()` |
| `src/lib/agent-api/idempotency.ts` (create) | `withIdempotency()` |
| `src/lib/agent-api/caps.ts` (create) | `enforceDailyCap()` |
| `src/lib/agent-api/contact-defaults.ts` (create) | `buildContactDoc()` shared by create + import |
| `src/test/fake-admin.ts` (create) | In-memory Firestore fake for unit tests |
| `src/middleware.ts` (modify: add one entry to `PUBLIC_PATHS`) | Let `/api/agent` bypass session auth |
| `src/app/api/agency/service-keys/route.ts` (create) | POST mint / GET list keys (agency owner, cookie-authed) |
| `src/app/api/agency/service-keys/[id]/route.ts` (create) | DELETE = revoke |
| `scripts/mint-service-key.mjs` (create) | Dev utility: mint first key from CLI with admin creds |
| `src/app/api/agent/v1/contacts/route.ts` (create) | POST create, GET search |
| `src/app/api/agent/v1/contacts/[id]/route.ts` (create) | GET, PATCH (fields + add/remove tags) |
| `src/app/api/agent/v1/contacts/import/route.ts` (create) | POST batch create |
| `src/app/api/agent/v1/deals/route.ts` (create) | POST create deal |
| `src/app/api/agent/v1/deals/[id]/route.ts` (create) | PATCH (stage move etc.) |
| `src/app/api/agent/v1/templates/route.ts` (create) | GET list, POST create |
| `src/app/api/agent/v1/templates/[id]/route.ts` (create) | GET, PATCH |
| `src/app/api/agent/v1/messages/email/route.ts` (create) | POST one-off send |
| `src/app/api/agent/v1/reports/summary/route.ts` (create) | GET counts |
| `docs/AGENT_API.md` (create) | Quick reference for the suit's MCP server (Phase 3 input) |

Tests live next to their modules in `__tests__/` directories (new convention for this repo — it has none): `src/lib/agent-api/__tests__/*.test.ts`, `src/app/api/agent/v1/__tests__/*.test.ts`.

---

### Task 1: Branch, Vitest setup, error envelope helper

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/agent-api/errors.ts`
- Test: `src/lib/agent-api/__tests__/errors.test.ts`
- Modify: `package.json` (scripts only)

**Interfaces:**
- Produces: `agentError(code: AgentErrorCode, message: string, status: number, details?: unknown, headers?: Record<string, string>): NextResponse` and type `AgentErrorCode`.

- [ ] **Step 1: Create the working branch**

```bash
cd C:/Users/starr/projects/ugotleads-live
git switch main
git switch -c feature/agent-bridge-phase1
git cherry-pick c514b5e fdca7ad   # the two AGENT_BRIDGE_SPEC.md commits
```

Expected: branch `feature/agent-bridge-phase1` with `docs/AGENT_BRIDGE_SPEC.md` present. If a cherry-pick conflicts (it only touches that one new file, so it shouldn't), take the incoming file wholesale.

- [ ] **Step 2: Install vitest and add scripts**

```bash
pnpm add -D vitest
```

In `package.json` `"scripts"`, add (keep existing entries):

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Route/lib modules import "server-only", which throws outside a
      // React Server environment. Stub it to a no-op for unit tests.
      "server-only": path.resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
});
```

Create `src/test/server-only-stub.ts`:

```ts
export {};
```

- [ ] **Step 4: Write the failing test**

`src/lib/agent-api/__tests__/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { agentError } from "@/lib/agent-api/errors";

describe("agentError", () => {
  it("returns the typed envelope with status", async () => {
    const res = agentError("VALIDATION_FAILED", "email is invalid", 400);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "VALIDATION_FAILED", message: "email is invalid" },
    });
  });

  it("includes details and custom headers when given", async () => {
    const res = agentError("CAP_EXCEEDED", "daily cap reached", 429, { limit: 100 }, { "Retry-After": "3600" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    const body = await res.json();
    expect(body.error.details).toEqual({ limit: 100 });
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot resolve `@/lib/agent-api/errors`.

- [ ] **Step 6: Write the implementation**

`src/lib/agent-api/errors.ts`:

```ts
import { NextResponse } from "next/server";

export type AgentErrorCode =
  | "INVALID_KEY"
  | "SCOPE_MISSING"
  | "SUB_ACCOUNT_FORBIDDEN"
  | "CAP_EXCEEDED"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "CONTACT_OPTED_OUT"
  | "CONFIRM_MISMATCH"
  | "SEND_FAILED";

export function agentError(
  code: AgentErrorCode,
  message: string,
  status: number,
  details?: unknown,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status, ...(headers ? { headers } : {}) },
  );
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm test`
Expected: 2 passed.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts src/test/server-only-stub.ts src/lib/agent-api package.json pnpm-lock.yaml
git commit -m "feat(agent-api): add vitest + typed agent error envelope"
```

---

### Task 2: Service-key types and key generation/hashing

**Files:**
- Create: `src/types/service-keys.ts`
- Create: `src/lib/agent-api/keys.ts`
- Test: `src/lib/agent-api/__tests__/keys.test.ts`

**Interfaces:**
- Produces: `ServiceScope` union, `ServiceKeyDoc` interface, `generateServiceKey(): { key: string; keyHash: string; keyPrefix: string }`, `hashServiceKey(key: string): string`.
- Consumed by: Task 3 (guard), Task 5 (mint route), tests everywhere.

- [ ] **Step 1: Write the failing test**

`src/lib/agent-api/__tests__/keys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateServiceKey, hashServiceKey } from "@/lib/agent-api/keys";

describe("service keys", () => {
  it("generates ugl_-prefixed 44-char keys with matching hash and prefix", () => {
    const { key, keyHash, keyPrefix } = generateServiceKey();
    expect(key).toMatch(/^ugl_[a-f0-9]{40}$/);
    expect(keyPrefix).toBe(key.slice(0, 8));
    expect(keyHash).toBe(hashServiceKey(key));
    expect(keyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("generates unique keys", () => {
    expect(generateServiceKey().key).not.toBe(generateServiceKey().key);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test keys`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/types/service-keys.ts`:

```ts
import type { Timestamp, FieldValue } from "firebase/firestore";

/** Permission scopes a service key may hold. Phase-2 scopes are reserved
 * here so the union doesn't churn when sequences/replies ship. */
export type ServiceScope =
  | "contacts:read"
  | "contacts:write"
  | "deals:write"
  | "templates:read"
  | "templates:write"
  | "sends:execute"
  | "reports:read"
  | "sequences:write"
  | "sequences:enroll"
  | "replies:read"
  | "replies:write";

/** Top-level `agencyServiceKeys/{keyId}` document. The plaintext key is
 * shown once at mint time and never stored. */
export interface ServiceKeyDoc {
  id: string;
  agencyId: string;
  label: string;
  /** sha256 hex of the full plaintext key. */
  keyHash: string;
  /** First 8 chars of the plaintext key, for display/audit (e.g. "ugl_a1b2"). */
  keyPrefix: string;
  allowedSubAccounts: string[];
  scopes: ServiceScope[];
  status: "active" | "revoked";
  createdByUid: string;
  createdAt: Timestamp | FieldValue | null;
  lastUsedAt: Timestamp | FieldValue | null;
}
```

`src/lib/agent-api/keys.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

export function hashServiceKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateServiceKey(): {
  key: string;
  keyHash: string;
  keyPrefix: string;
} {
  const key = `ugl_${randomBytes(20).toString("hex")}`;
  return { key, keyHash: hashServiceKey(key), keyPrefix: key.slice(0, 8) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test keys`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/types/service-keys.ts src/lib/agent-api/keys.ts src/lib/agent-api/__tests__/keys.test.ts
git commit -m "feat(agent-api): service key types + generation/hashing"
```

---

### Task 3: Fake Firestore admin test helper

**Files:**
- Create: `src/test/fake-admin.ts`
- Test: `src/test/__tests__/fake-admin.test.ts` (include glob already covers `src/**`)

**Interfaces:**
- Produces: `FakeDb` class + singleton `fakeDb` + `resetFakeDb()`. Supports: `doc(path).get()/set(data, {merge}?)/update(data)/delete()`, `collection(path).add(data)`, chained `.where(field, "==" | "array-contains", value).limit(n).select(...fields).get()`, `runTransaction(fn)`. Doc snapshots expose `{ id, exists, data(), ref }`.
- Consumed by: every route/guard test via `vi.mock("@/lib/firebase/admin", ...)`.

- [ ] **Step 1: Write the failing test**

`src/test/__tests__/fake-admin.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";

describe("FakeDb", () => {
  beforeEach(resetFakeDb);

  it("set/get/update/delete a doc", async () => {
    fakeDb.doc("contacts/c1").set({ name: "Ann", tags: ["a"] });
    let snap = await fakeDb.doc("contacts/c1").get();
    expect(snap.exists).toBe(true);
    expect(snap.data()).toEqual({ name: "Ann", tags: ["a"] });
    await fakeDb.doc("contacts/c1").update({ name: "Ann B" });
    snap = await fakeDb.doc("contacts/c1").get();
    expect(snap.data()?.name).toBe("Ann B");
    await fakeDb.doc("contacts/c1").delete();
    snap = await fakeDb.doc("contacts/c1").get();
    expect(snap.exists).toBe(false);
  });

  it("filters with where == and array-contains, respects limit", async () => {
    fakeDb.doc("contacts/c1").set({ subAccountId: "s1", tags: ["box1"] });
    fakeDb.doc("contacts/c2").set({ subAccountId: "s1", tags: [] });
    fakeDb.doc("contacts/c3").set({ subAccountId: "s2", tags: ["box1"] });
    const snap = await fakeDb
      .collection("contacts")
      .where("subAccountId", "==", "s1")
      .where("tags", "array-contains", "box1")
      .get();
    expect(snap.size).toBe(1);
    expect(snap.docs[0].id).toBe("c1");
    const limited = await fakeDb.collection("contacts").limit(2).get();
    expect(limited.size).toBe(2);
  });

  it("add() returns a ref with a generated id", async () => {
    const ref = await fakeDb.collection("deals").add({ title: "T" });
    const snap = await fakeDb.doc(`deals/${ref.id}`).get();
    expect(snap.data()?.title).toBe("T");
  });

  it("runTransaction exposes get/set/update", async () => {
    fakeDb.doc("k/u").set({ n: 1 });
    await fakeDb.runTransaction(async (tx) => {
      const s = await tx.get(fakeDb.doc("k/u"));
      tx.set(fakeDb.doc("k/u"), { n: (s.data()?.n as number) + 1 }, { merge: true });
    });
    expect((await fakeDb.doc("k/u").get()).data()?.n).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test fake-admin`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/test/fake-admin.ts`:

```ts
/**
 * Minimal in-memory stand-in for the Firestore Admin SDK — just enough
 * surface for the agent-api routes. Not a general-purpose fake.
 * FieldValue sentinels (serverTimestamp etc.) are stored as-is; tests
 * must not assert on timestamp fields.
 */
type DocData = Record<string, unknown>;

interface FakeSnap {
  id: string;
  exists: boolean;
  ref: FakeDocRef;
  data(): DocData | undefined;
}

export class FakeDocRef {
  constructor(
    private db: FakeDb,
    public path: string,
  ) {}

  get id(): string {
    return this.path.split("/").pop() as string;
  }

  async get(): Promise<FakeSnap> {
    const data = this.db.store.get(this.path);
    return {
      id: this.id,
      exists: data !== undefined,
      ref: this,
      data: () => (data ? { ...data } : undefined),
    };
  }

  set(data: DocData, opts?: { merge?: boolean }): Promise<void> {
    const existing = this.db.store.get(this.path);
    this.db.store.set(
      this.path,
      opts?.merge && existing ? { ...existing, ...data } : { ...data },
    );
    return Promise.resolve();
  }

  async update(data: DocData): Promise<void> {
    const existing = this.db.store.get(this.path);
    if (!existing) throw new Error(`update on missing doc ${this.path}`);
    this.db.store.set(this.path, { ...existing, ...data });
  }

  async delete(): Promise<void> {
    this.db.store.delete(this.path);
  }
}

type Filter = { field: string; op: "==" | "array-contains"; value: unknown };

class FakeQuery {
  constructor(
    private db: FakeDb,
    private collectionPath: string,
    private filters: Filter[] = [],
    private limitN: number | null = null,
  ) {}

  where(field: string, op: "==" | "array-contains", value: unknown): FakeQuery {
    return new FakeQuery(this.db, this.collectionPath, [...this.filters, { field, op, value }], this.limitN);
  }

  limit(n: number): FakeQuery {
    return new FakeQuery(this.db, this.collectionPath, this.filters, n);
  }

  select(..._fields: string[]): FakeQuery {
    return this; // projection is a perf detail; the fake returns full docs
  }

  async get(): Promise<{ empty: boolean; size: number; docs: FakeSnap[] }> {
    const prefix = `${this.collectionPath}/`;
    let docs: FakeSnap[] = [];
    for (const [path, data] of this.db.store) {
      if (!path.startsWith(prefix)) continue;
      if (path.slice(prefix.length).includes("/")) continue; // exclude subcollections
      const matches = this.filters.every((f) => {
        const v = data[f.field];
        if (f.op === "==") return v === f.value;
        return Array.isArray(v) && v.includes(f.value);
      });
      if (!matches) continue;
      const ref = new FakeDocRef(this.db, path);
      docs.push({ id: ref.id, exists: true, ref, data: () => ({ ...data }) });
    }
    if (this.limitN !== null) docs = docs.slice(0, this.limitN);
    return { empty: docs.length === 0, size: docs.length, docs };
  }

  async add(data: DocData): Promise<FakeDocRef> {
    const id = `fake${(this.db.nextId++).toString(36).padStart(6, "0")}`;
    const ref = new FakeDocRef(this.db, `${this.collectionPath}/${id}`);
    await ref.set(data);
    return ref;
  }
}

export class FakeDb {
  store = new Map<string, DocData>();
  nextId = 1;

  doc(path: string): FakeDocRef {
    return new FakeDocRef(this, path);
  }

  collection(path: string): FakeQuery {
    return new FakeQuery(this, path);
  }

  async runTransaction<T>(
    fn: (tx: {
      get: (ref: FakeDocRef) => Promise<FakeSnap>;
      set: (ref: FakeDocRef, data: DocData, opts?: { merge?: boolean }) => void;
      update: (ref: FakeDocRef, data: DocData) => void;
    }) => Promise<T>,
  ): Promise<T> {
    return fn({
      get: (ref) => ref.get(),
      set: (ref, data, opts) => void ref.set(data, opts),
      update: (ref, data) => void ref.update(data),
    });
  }
}

export const fakeDb = new FakeDb();

export function resetFakeDb(): void {
  fakeDb.store.clear();
  fakeDb.nextId = 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test fake-admin`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/test/fake-admin.ts src/test/__tests__/fake-admin.test.ts
git commit -m "test: in-memory Firestore admin fake for agent-api tests"
```

---

### Task 4: `requireServiceAuth` guard + middleware public path

**Files:**
- Create: `src/lib/auth/require-service-auth.ts`
- Modify: `src/middleware.ts` (one entry in `PUBLIC_PATHS`, after line 44's `"/api/affiliate"`)
- Test: `src/lib/agent-api/__tests__/require-service-auth.test.ts`

**Interfaces:**
- Consumes: `hashServiceKey` (Task 2), `agentError` (Task 1), `ServiceKeyDoc`/`ServiceScope` (Task 2).
- Produces:
  ```ts
  interface AgentAccess {
    keyId: string;
    keyPrefix: string;
    agencyId: string;
    scopes: ServiceScope[];
    allowedSubAccounts: string[];
    subAccountId: string | null; // resolved when opts.subAccountId was given
  }
  requireServiceAuth(request: Request, opts: { scope: ServiceScope; subAccountId?: string }): Promise<AgentAccess | NextResponse>
  subAccountAllowed(access: AgentAccess, subAccountId: string): boolean
  ```
  Every agent route in Tasks 7–13 calls these.

- [ ] **Step 1: Write the failing test**

`src/lib/agent-api/__tests__/require-service-auth.test.ts` (this `vi.mock` pattern is the template for ALL route tests in later tasks — copy it exactly):

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test require-service-auth`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/lib/auth/require-service-auth.ts`:

```ts
import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { hashServiceKey } from "@/lib/agent-api/keys";
import type { ServiceKeyDoc, ServiceScope } from "@/types/service-keys";

export interface AgentAccess {
  keyId: string;
  keyPrefix: string;
  agencyId: string;
  scopes: ServiceScope[];
  allowedSubAccounts: string[];
  subAccountId: string | null;
}

/**
 * Auth guard for /api/agent/v1/* routes. Mirrors the shape of
 * require-tenancy.ts guards: returns AgentAccess on success, or a
 * ready-to-return NextResponse on failure.
 *
 * When the route knows its sub-account up front, pass opts.subAccountId
 * and the allowlist check happens here. Routes that resolve the
 * sub-account from a loaded doc (contact/deal/template) pass no
 * subAccountId and MUST call subAccountAllowed() themselves after
 * loading the doc.
 */
export async function requireServiceAuth(
  request: Request,
  opts: { scope: ServiceScope; subAccountId?: string },
): Promise<AgentAccess | NextResponse> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (ugl_[a-f0-9]{40})$/.exec(header);
  if (!match) {
    return agentError("INVALID_KEY", "Missing or malformed service key.", 401);
  }

  const db = getAdminDb();
  const snap = await db
    .collection("agencyServiceKeys")
    .where("keyHash", "==", hashServiceKey(match[1]))
    .limit(1)
    .get();
  if (snap.empty) {
    return agentError("INVALID_KEY", "Unknown service key.", 401);
  }

  const doc = snap.docs[0];
  const key = doc.data() as Omit<ServiceKeyDoc, "id">;
  if (key.status !== "active") {
    return agentError("INVALID_KEY", "Service key has been revoked.", 401);
  }
  if (!key.scopes.includes(opts.scope)) {
    return agentError("SCOPE_MISSING", `Key lacks required scope "${opts.scope}".`, 403);
  }
  if (opts.subAccountId && !key.allowedSubAccounts.includes(opts.subAccountId)) {
    return agentError("SUB_ACCOUNT_FORBIDDEN", "Key cannot access this sub-account.", 403);
  }

  // Audit trail; failure here must never fail the request.
  void doc.ref
    .update({ lastUsedAt: FieldValue.serverTimestamp() })
    .catch(() => {});

  return {
    keyId: doc.id,
    keyPrefix: key.keyPrefix,
    agencyId: key.agencyId,
    scopes: key.scopes,
    allowedSubAccounts: key.allowedSubAccounts,
    subAccountId: opts.subAccountId ?? null,
  };
}

export function subAccountAllowed(access: AgentAccess, subAccountId: string): boolean {
  return access.allowedSubAccounts.includes(subAccountId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test require-service-auth`
Expected: 5 passed.

- [ ] **Step 5: Add the middleware public path**

In `src/middleware.ts`, inside `PUBLIC_PATHS`, after the `"/api/affiliate",` line (line 44), add:

```ts
  // Agent API — machine callers with service keys. Session middleware is
  // bypassed; every route authenticates itself via requireServiceAuth().
  "/api/agent",
];
```

(Only the two comment lines and `"/api/agent",` are new — the closing `];` already exists.)

- [ ] **Step 6: Verify firestore.rules is default-deny for the new collections**

Run: `grep -n "match /{document" firestore.rules; grep -n "agencyServiceKeys\|agentIdempotency" firestore.rules`
Expected: no `allow read, write: if true`-style wildcard; no matches for the new collections (Firestore denies client access to unmatched collections by default). If the rules file has a permissive wildcard match, STOP and flag it to Star — that's a pre-existing security problem, don't work around it silently.

- [ ] **Step 7: Typecheck + full test run, then commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean compile, all tests pass.

```bash
git add src/lib/auth/require-service-auth.ts src/middleware.ts src/lib/agent-api/__tests__/require-service-auth.test.ts
git commit -m "feat(agent-api): service-key auth guard + /api/agent public path"
```

---

### Task 5: Key management (mint/list/revoke) + CLI mint script

**Files:**
- Create: `src/app/api/agency/service-keys/route.ts`
- Create: `src/app/api/agency/service-keys/[id]/route.ts`
- Create: `scripts/mint-service-key.mjs`
- Test: `src/app/api/agency/__tests__/service-keys.test.ts`

**Interfaces:**
- Consumes: `generateServiceKey` (Task 2), `ServiceScope` (Task 2).
- Produces: `POST /api/agency/service-keys` body `{ label, allowedSubAccounts: string[], scopes: ServiceScope[] }` → `201 { data: { id, key, keyPrefix } }` (plaintext key returned ONCE). `GET` → `{ data: [{ id, label, keyPrefix, allowedSubAccounts, scopes, status }] }`. `DELETE /api/agency/service-keys/[id]` → `{ data: { id, status: "revoked" } }`.
- These routes are **cookie-authed** (normal dashboard auth — NOT under `/api/agent`): they read `x-user-uid` and require agency-owner claims, following the local-`readCaller` pattern from `src/app/api/contacts/bulk/route.ts:15-27`.

- [ ] **Step 1: Write the failing test**

`src/app/api/agency/__tests__/service-keys.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return {
    getAdminDb: () => fakeDb,
    getAdminAuth: () => ({
      getUser: async (uid: string) => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test service-keys`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/app/api/agency/service-keys/route.ts`**

```ts
import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { generateServiceKey } from "@/lib/agent-api/keys";
import type { ServiceScope } from "@/types/service-keys";

const VALID_SCOPES: ServiceScope[] = [
  "contacts:read", "contacts:write", "deals:write", "templates:read",
  "templates:write", "sends:execute", "reports:read", "sequences:write",
  "sequences:enroll", "replies:read", "replies:write",
];

interface OwnerCaller {
  uid: string;
  agencyId: string;
}

/** Local owner check, following the pattern in api/contacts/bulk/route.ts. */
async function readOwner(request: Request): Promise<OwnerCaller | NextResponse> {
  const uid = request.headers.get("x-user-uid");
  if (!uid) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const record = await getAdminAuth().getUser(uid).catch(() => null);
  const claims = (record?.customClaims ?? {}) as {
    status?: string;
    agencyId?: string | null;
    agencyRole?: string | null;
  };
  if (claims.status !== "active")
    return NextResponse.json({ error: "Account inactive" }, { status: 403 });
  if (claims.agencyRole !== "owner" || !claims.agencyId)
    return NextResponse.json({ error: "Agency owner only" }, { status: 403 });
  return { uid, agencyId: claims.agencyId };
}

export async function POST(request: Request) {
  const owner = await readOwner(request);
  if (owner instanceof NextResponse) return owner;

  const body = (await request.json().catch(() => null)) as {
    label?: string;
    allowedSubAccounts?: string[];
    scopes?: string[];
  } | null;

  const label = body?.label?.trim();
  const allowedSubAccounts = body?.allowedSubAccounts;
  const scopes = body?.scopes;
  if (
    !label ||
    !Array.isArray(allowedSubAccounts) || allowedSubAccounts.length === 0 ||
    !Array.isArray(scopes) || scopes.length === 0 ||
    !scopes.every((s) => (VALID_SCOPES as string[]).includes(s))
  ) {
    return NextResponse.json(
      { error: "label, allowedSubAccounts[], and valid scopes[] are required." },
      { status: 400 },
    );
  }

  const db = getAdminDb();
  // Every allowed sub-account must belong to the owner's agency.
  for (const saId of allowedSubAccounts) {
    const sa = await db.doc(`subAccounts/${saId}`).get();
    if (!sa.exists || sa.data()?.agencyId !== owner.agencyId) {
      return NextResponse.json(
        { error: `Sub-account ${saId} not found in your agency.` },
        { status: 400 },
      );
    }
  }

  const { key, keyHash, keyPrefix } = generateServiceKey();
  const ref = await db.collection("agencyServiceKeys").add({
    agencyId: owner.agencyId,
    label,
    keyHash,
    keyPrefix,
    allowedSubAccounts,
    scopes,
    status: "active",
    createdByUid: owner.uid,
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: null,
  });

  // Plaintext key is returned exactly once and never persisted.
  return NextResponse.json(
    { data: { id: ref.id, key, keyPrefix } },
    { status: 201 },
  );
}

export async function GET(request: Request) {
  const owner = await readOwner(request);
  if (owner instanceof NextResponse) return owner;

  const snap = await getAdminDb()
    .collection("agencyServiceKeys")
    .where("agencyId", "==", owner.agencyId)
    .get();

  const data = snap.docs.map((d) => {
    const k = d.data();
    return {
      id: d.id,
      label: k.label,
      keyPrefix: k.keyPrefix,
      allowedSubAccounts: k.allowedSubAccounts,
      scopes: k.scopes,
      status: k.status,
      createdAt: k.createdAt ?? null,
      lastUsedAt: k.lastUsedAt ?? null,
    };
  });
  return NextResponse.json({ data });
}
```

- [ ] **Step 4: Write `src/app/api/agency/service-keys/[id]/route.ts`**

```ts
import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const uid = request.headers.get("x-user-uid");
  if (!uid) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const record = await getAdminAuth().getUser(uid).catch(() => null);
  const claims = (record?.customClaims ?? {}) as {
    status?: string;
    agencyId?: string | null;
    agencyRole?: string | null;
  };
  if (claims.status !== "active")
    return NextResponse.json({ error: "Account inactive" }, { status: 403 });
  if (claims.agencyRole !== "owner" || !claims.agencyId)
    return NextResponse.json({ error: "Agency owner only" }, { status: 403 });

  const db = getAdminDb();
  const ref = db.doc(`agencyServiceKeys/${id}`);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.agencyId !== claims.agencyId) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  await ref.update({ status: "revoked" });
  return NextResponse.json({ data: { id, status: "revoked" } });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test service-keys`
Expected: 4 passed.

- [ ] **Step 6: Write the CLI mint script**

`scripts/mint-service-key.mjs` (dev utility so Star can mint the first key without a browser session; intentionally duplicates the 3-line hashing logic because `.mjs` can't import the TS lib):

```js
// Usage:
//   node scripts/mint-service-key.mjs --label suit-bridge \
//     --sub-account DDEParISNUlxoMiimi2X \
//     --scopes contacts:read,contacts:write,deals:write,templates:read,templates:write,sends:execute,reports:read
//
// Reads FIREBASE_ADMIN_* from .env.local. Prints the plaintext key ONCE.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

const label = arg("label");
const subAccount = arg("sub-account");
const scopes = (arg("scopes") ?? "").split(",").filter(Boolean);
if (!label || !subAccount || scopes.length === 0) {
  console.error("Required: --label, --sub-account, --scopes (comma-separated)");
  process.exit(1);
}

// Minimal .env.local loader (no dotenv dependency).
const env = { ...process.env };
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch {
  /* .env.local optional if env vars already exported */
}

initializeApp({
  credential: cert({
    projectId: env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: (env.FIREBASE_ADMIN_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  }),
});
const db = getFirestore();

const sa = await db.doc(`subAccounts/${subAccount}`).get();
if (!sa.exists) {
  console.error(`Sub-account ${subAccount} not found.`);
  process.exit(1);
}

const key = `ugl_${randomBytes(20).toString("hex")}`;
const keyHash = createHash("sha256").update(key).digest("hex");
const ref = await db.collection("agencyServiceKeys").add({
  agencyId: sa.data().agencyId,
  label,
  keyHash,
  keyPrefix: key.slice(0, 8),
  allowedSubAccounts: [subAccount],
  scopes,
  status: "active",
  createdByUid: "script:mint-service-key",
  createdAt: FieldValue.serverTimestamp(),
  lastUsedAt: null,
});

console.log(`Key id:     ${ref.id}`);
console.log(`Plaintext:  ${key}`);
console.log("Store this in the suit's .env now — it is not shown again.");
```

- [ ] **Step 7: Typecheck + full suite, then commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean.

```bash
git add src/app/api/agency scripts/mint-service-key.mjs
git commit -m "feat(agent-api): service-key mint/list/revoke routes + CLI mint script"
```

---

### Task 6: Idempotency + daily-cap helpers

**Files:**
- Create: `src/lib/agent-api/idempotency.ts`
- Create: `src/lib/agent-api/caps.ts`
- Test: `src/lib/agent-api/__tests__/idempotency-caps.test.ts`

**Interfaces:**
- Consumes: `agentError` (Task 1).
- Produces:
  ```ts
  type AgentHandlerResult = { status: number; body: unknown };
  withIdempotency(request: Request, keyId: string, handler: () => Promise<AgentHandlerResult>): Promise<NextResponse>
  enforceDailyCap(keyId: string, cap: "sends", limit: number): Promise<NextResponse | null>  // null = under cap, counted
  ```
- Consumed by: Tasks 7, 9, 10, 12 (mutating routes).

- [ ] **Step 1: Write the failing test**

`src/lib/agent-api/__tests__/idempotency-caps.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { withIdempotency } from "@/lib/agent-api/idempotency";
import { enforceDailyCap } from "@/lib/agent-api/caps";

function req(idemKey?: string): Request {
  return new Request("http://test/x", {
    method: "POST",
    headers: idemKey ? { "idempotency-key": idemKey } : {},
  });
}

describe("withIdempotency", () => {
  beforeEach(resetFakeDb);

  it("runs the handler every time without a key", async () => {
    let calls = 0;
    const handler = async () => ({ status: 201, body: { data: { n: ++calls } } });
    await withIdempotency(req(), "key1", handler);
    const res = await withIdempotency(req(), "key1", handler);
    expect(calls).toBe(2);
    expect((await res.json()).data.n).toBe(2);
  });

  it("replays the stored response for a repeated key", async () => {
    let calls = 0;
    const handler = async () => ({ status: 201, body: { data: { n: ++calls } } });
    const first = await withIdempotency(req("abc"), "key1", handler);
    const second = await withIdempotency(req("abc"), "key1", handler);
    expect(calls).toBe(1);
    expect(second.status).toBe(201);
    expect((await second.json())).toEqual(await first.json());
    expect(second.headers.get("x-idempotent-replay")).toBe("true");
  });

  it("scopes idempotency per service key", async () => {
    let calls = 0;
    const handler = async () => ({ status: 200, body: { data: { n: ++calls } } });
    await withIdempotency(req("abc"), "key1", handler);
    await withIdempotency(req("abc"), "key2", handler);
    expect(calls).toBe(2);
  });
});

describe("enforceDailyCap", () => {
  beforeEach(resetFakeDb);

  it("allows up to the limit then returns 429 with Retry-After", async () => {
    expect(await enforceDailyCap("key1", "sends", 2)).toBeNull();
    expect(await enforceDailyCap("key1", "sends", 2)).toBeNull();
    const blocked = await enforceDailyCap("key1", "sends", 2);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(Number(blocked!.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await blocked!.json()).error.code).toBe("CAP_EXCEEDED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test idempotency-caps`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/lib/agent-api/idempotency.ts`**

```ts
import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

export type AgentHandlerResult = { status: number; body: unknown };

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Replay-safe wrapper for mutating agent routes. If the caller sends an
 * Idempotency-Key header and we already stored a response for it (within
 * 24h), replay the stored response instead of re-running the handler.
 *
 * Known small race: two truly concurrent requests with the same fresh key
 * can both run the handler (get-then-set, no transaction). Acceptable for
 * v1 — the caller is a single orchestrator, not a fleet.
 */
export async function withIdempotency(
  request: Request,
  keyId: string,
  handler: () => Promise<AgentHandlerResult>,
): Promise<NextResponse> {
  const idemKey = request.headers.get("idempotency-key");
  if (!idemKey) {
    const r = await handler();
    return NextResponse.json(r.body, { status: r.status });
  }

  const db = getAdminDb();
  const docId = `${keyId}_${createHash("sha256").update(idemKey).digest("hex").slice(0, 32)}`;
  const ref = db.doc(`agentIdempotency/${docId}`);

  const snap = await ref.get();
  if (snap.exists) {
    const saved = snap.data() as { status: number; body: unknown; expiresAtMs: number };
    if (saved.expiresAtMs > Date.now()) {
      return NextResponse.json(saved.body, {
        status: saved.status,
        headers: { "x-idempotent-replay": "true" },
      });
    }
  }

  const r = await handler();
  // Only cache definitive outcomes; a 5xx should be retryable.
  if (r.status < 500) {
    await ref.set({
      status: r.status,
      body: r.body,
      expiresAtMs: Date.now() + TTL_MS,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return NextResponse.json(r.body, { status: r.status });
}
```

- [ ] **Step 4: Write `src/lib/agent-api/caps.ts`**

```ts
import "server-only";

import type { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";

class CapExceededError extends Error {}

/**
 * Transactionally count one unit against the key's daily cap.
 * Returns null when under the cap (and the unit is counted), or a
 * ready-to-return 429 NextResponse when the cap is reached.
 * Counter doc: agencyServiceKeys/{keyId}/usage/{YYYY-MM-DD} (UTC).
 */
export async function enforceDailyCap(
  keyId: string,
  cap: "sends",
  limit: number,
): Promise<NextResponse | null> {
  const db = getAdminDb();
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`agencyServiceKeys/${keyId}/usage/${day}`);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? ((snap.data()?.[cap] as number) ?? 0) : 0;
      if (current >= limit) throw new CapExceededError();
      tx.set(ref, { [cap]: current + 1 }, { merge: true });
    });
    return null;
  } catch (err) {
    if (err instanceof CapExceededError) {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setUTCHours(24, 0, 0, 0);
      const retryAfter = Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 1000));
      return agentError(
        "CAP_EXCEEDED",
        `Daily ${cap} cap of ${limit} reached for this key.`,
        429,
        { limit },
        { "Retry-After": String(retryAfter) },
      );
    }
    throw err;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test idempotency-caps`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent-api/idempotency.ts src/lib/agent-api/caps.ts src/lib/agent-api/__tests__/idempotency-caps.test.ts
git commit -m "feat(agent-api): idempotency replay + transactional daily caps"
```

---

### Task 7: Agent contacts — create + search

**Files:**
- Create: `src/lib/agent-api/contact-defaults.ts`
- Create: `src/app/api/agent/v1/contacts/route.ts`
- Test: `src/app/api/agent/v1/__tests__/contacts.test.ts`

**Interfaces:**
- Consumes: `requireServiceAuth`/`subAccountAllowed` (Task 4), `agentError` (Task 1), `withIdempotency` (Task 6), `AgentAccess` (Task 4).
- Produces:
  - `buildContactDoc(access: AgentAccess, input: AgentContactInput): Record<string, unknown>` where `AgentContactInput = { name?: string; email?: string; phone?: string; company?: string; tags?: string[]; source?: string; pipelineStage?: string }` — reused by Task 9 import.
  - `isValidEmail(s: string): boolean` — reused by Task 9.
  - `POST /api/agent/v1/contacts` body `{ subAccountId, name?, email?, phone?, company?, tags?, pipelineStage? }` → `201 { data: { id } }`; duplicate email in sub-account → `409 VALIDATION_FAILED` with `details.existingId`.
  - `GET /api/agent/v1/contacts?subAccountId=...&email=&phone=&tag=&pipelineStage=&limit=` → `{ data: [{ id, name, email, phone, company, tags, pipelineStage, emailOptedOut, smsOptedOut }] }`.

- [ ] **Step 1: Write the failing test**

`src/app/api/agent/v1/__tests__/contacts.test.ts` (seed a key with the helper pattern from Task 4's test — repeated here in full):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { POST, GET } from "@/app/api/agent/v1/contacts/route";

let KEY: string;

function seedKey() {
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1",
    label: "t",
    keyHash: gen.keyHash,
    keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"],
    scopes: ["contacts:read", "contacts:write"],
    status: "active",
  });
  KEY = gen.key;
}

function post(body: unknown): Request {
  return new Request("http://test/api/agent/v1/contacts", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function get(qs: string): Request {
  return new Request(`http://test/api/agent/v1/contacts?${qs}`, {
    headers: { authorization: `Bearer ${KEY}` },
  });
}

describe("agent contacts", () => {
  beforeEach(() => {
    resetFakeDb();
    seedKey();
  });

  it("creates a contact with agent-stamped defaults", async () => {
    const res = await POST(
      post({ subAccountId: "subMain", name: "Ann", email: "Ann@Ex.com", tags: ["box1"] }),
    );
    expect(res.status).toBe(201);
    const { id } = (await res.json()).data;
    const doc = (await fakeDb.doc(`contacts/${id}`).get()).data()!;
    expect(doc).toMatchObject({
      name: "Ann",
      email: "ann@ex.com",
      agencyId: "ag1",
      subAccountId: "subMain",
      tags: ["box1"],
      pipelineStage: "new",
      emailOptedOut: false,
      smsOptedOut: false,
    });
    expect(doc.createdByUid).toMatch(/^agent:ugl_/);
  });

  it("requires email or phone", async () => {
    const res = await POST(post({ subAccountId: "subMain", name: "NoContact" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
  });

  it("409s on duplicate email within the sub-account", async () => {
    await POST(post({ subAccountId: "subMain", email: "dup@ex.com" }));
    const res = await POST(post({ subAccountId: "subMain", email: "dup@ex.com" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.details.existingId).toBeDefined();
  });

  it("searches by tag within the allowed sub-account", async () => {
    await POST(post({ subAccountId: "subMain", email: "a@ex.com", tags: ["box1"] }));
    await POST(post({ subAccountId: "subMain", email: "b@ex.com", tags: [] }));
    const res = await GET(get("subAccountId=subMain&tag=box1"));
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].email).toBe("a@ex.com");
  });

  it("403s when searching a sub-account outside the allowlist", async () => {
    const res = await GET(get("subAccountId=subOther"));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/contacts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/lib/agent-api/contact-defaults.ts`**

```ts
import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { AgentAccess } from "@/lib/auth/require-service-auth";

export interface AgentContactInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  tags?: string[];
  source?: string;
  pipelineStage?: string;
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Full Contact document (see src/types/contacts.ts) with agent defaults.
 * subAccountId must already be resolved+authorized on `access`. */
export function buildContactDoc(
  access: AgentAccess,
  input: AgentContactInput,
): Record<string, unknown> {
  return {
    name: input.name?.trim() ?? "",
    email: input.email?.trim().toLowerCase() ?? "",
    phone: input.phone?.trim() ?? "",
    company: input.company?.trim() ?? "",
    source: input.source?.trim() || "other",
    tags: (input.tags ?? []).map((t) => t.trim().slice(0, 50)).filter(Boolean),
    pipelineStage: input.pipelineStage ?? "new",
    attribution: null,
    agencyId: access.agencyId,
    subAccountId: access.subAccountId,
    createdByUid: `agent:${access.keyPrefix}`,
    emailOptedOut: false,
    smsOptedOut: false,
    countryCode: null,
    country: null,
    city: null,
    lat: null,
    lng: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}
```

- [ ] **Step 4: Write `src/app/api/agent/v1/contacts/route.ts`**

```ts
import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withIdempotency } from "@/lib/agent-api/idempotency";
import {
  buildContactDoc,
  isValidEmail,
  type AgentContactInput,
} from "@/lib/agent-api/contact-defaults";
import { requireServiceAuth } from "@/lib/auth/require-service-auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | (AgentContactInput & { subAccountId?: string })
    | null;
  if (!body || typeof body.subAccountId !== "string" || !body.subAccountId) {
    return agentError("VALIDATION_FAILED", "subAccountId is required.", 400);
  }

  const access = await requireServiceAuth(request, {
    scope: "contacts:write",
    subAccountId: body.subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const email = body.email?.trim().toLowerCase() ?? "";
  const phone = body.phone?.trim() ?? "";
  if (!email && !phone) {
    return agentError("VALIDATION_FAILED", "A valid email or a phone number is required.", 400);
  }
  if (email && !isValidEmail(email)) {
    return agentError("VALIDATION_FAILED", "Email format is invalid.", 400);
  }

  return withIdempotency(request, access.keyId, async () => {
    const db = getAdminDb();
    if (email) {
      const dup = await db
        .collection("contacts")
        .where("subAccountId", "==", access.subAccountId)
        .where("email", "==", email)
        .limit(1)
        .get();
      if (!dup.empty) {
        return {
          status: 409,
          body: {
            error: {
              code: "VALIDATION_FAILED",
              message: "A contact with this email already exists in the sub-account.",
              details: { existingId: dup.docs[0].id },
            },
          },
        };
      }
    }
    const ref = await db.collection("contacts").add(buildContactDoc(access, body));
    return { status: 201, body: { data: { id: ref.id } } };
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const subAccountId = url.searchParams.get("subAccountId");
  if (!subAccountId) {
    return agentError("VALIDATION_FAILED", "subAccountId query param is required.", 400);
  }

  const access = await requireServiceAuth(request, {
    scope: "contacts:read",
    subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
  let q = getAdminDb()
    .collection("contacts")
    .where("subAccountId", "==", subAccountId);
  const email = url.searchParams.get("email");
  const phone = url.searchParams.get("phone");
  const tag = url.searchParams.get("tag");
  const pipelineStage = url.searchParams.get("pipelineStage");
  if (email) q = q.where("email", "==", email.trim().toLowerCase());
  if (phone) q = q.where("phone", "==", phone.trim());
  if (tag) q = q.where("tags", "array-contains", tag);
  if (pipelineStage) q = q.where("pipelineStage", "==", pipelineStage);

  const snap = await q.limit(limit).get();
  const data = snap.docs.map((d) => {
    const c = d.data();
    return {
      id: d.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      company: c.company,
      tags: c.tags,
      pipelineStage: c.pipelineStage,
      emailOptedOut: c.emailOptedOut,
      smsOptedOut: c.smsOptedOut,
    };
  });
  return NextResponse.json({ data });
}
```

Note: combining `tags array-contains` with equality filters may require a composite index in real Firestore. On first live use, Firestore returns an error containing a console link — click it to create the index. Add any created indexes to the smoke-test notes in Task 14.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test __tests__/contacts`
Expected: 5 passed.

- [ ] **Step 6: Typecheck, then commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add src/lib/agent-api/contact-defaults.ts src/app/api/agent/v1/contacts/route.ts src/app/api/agent/v1/__tests__/contacts.test.ts
git commit -m "feat(agent-api): contact create + search routes"
```

---

### Task 8: Agent contact detail — get + patch (fields, tags)

**Files:**
- Create: `src/app/api/agent/v1/contacts/[id]/route.ts`
- Test: `src/app/api/agent/v1/__tests__/contact-detail.test.ts`

**Interfaces:**
- Consumes: `requireServiceAuth` WITHOUT `subAccountId` (contact doc resolves it) + `subAccountAllowed` (Task 4), `isValidEmail` (Task 7).
- Produces:
  - `GET /api/agent/v1/contacts/[id]` → `{ data: { id, ...contact fields } }`
  - `PATCH /api/agent/v1/contacts/[id]` body `{ name?, company?, phone?, email?, pipelineStage?, addTags?: string[], removeTags?: string[] }` → `{ data: { id, tags, pipelineStage } }`. Tags are computed read-modify-write (no `FieldValue.arrayUnion` — the route already reads the doc, and plain arrays keep the fake-db assertions honest). A `pipelineStage` change writes a `pipeline_moved` activity with `createdBy: "agent:<keyPrefix>"`.

- [ ] **Step 1: Write the failing test**

`src/app/api/agent/v1/__tests__/contact-detail.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { GET, PATCH } from "@/app/api/agent/v1/contacts/[id]/route";

let KEY: string;

beforeEach(() => {
  resetFakeDb();
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1", label: "t", keyHash: gen.keyHash, keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"], scopes: ["contacts:read", "contacts:write"], status: "active",
  });
  KEY = gen.key;
  fakeDb.doc("contacts/c1").set({
    name: "Ann", email: "a@ex.com", phone: "", company: "", tags: ["box1"],
    pipelineStage: "new", agencyId: "ag1", subAccountId: "subMain",
    emailOptedOut: false, smsOptedOut: false,
  });
  fakeDb.doc("contacts/cForeign").set({
    name: "X", email: "x@ex.com", tags: [], pipelineStage: "new",
    agencyId: "ag1", subAccountId: "subOther", emailOptedOut: false, smsOptedOut: false,
  });
});

function patch(id: string, body: unknown): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://test/api/agent/v1/contacts/${id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

describe("agent contact detail", () => {
  it("gets a contact in an allowed sub-account", async () => {
    const res = await GET(
      new Request("http://test/x", { headers: { authorization: `Bearer ${KEY}` } }),
      { params: Promise.resolve({ id: "c1" }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.name).toBe("Ann");
  });

  it("403s for a contact outside the allowlist and 404s for missing", async () => {
    const forbidden = await GET(
      new Request("http://test/x", { headers: { authorization: `Bearer ${KEY}` } }),
      { params: Promise.resolve({ id: "cForeign" }) },
    );
    expect(forbidden.status).toBe(403);
    const missing = await GET(
      new Request("http://test/x", { headers: { authorization: `Bearer ${KEY}` } }),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(missing.status).toBe(404);
  });

  it("adds and removes tags in one call", async () => {
    const res = await PATCH(...patch("c1", { addTags: ["box1", "warm"], removeTags: ["box1"] }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.tags).toEqual(["warm"]);
  });

  it("moves pipeline stage and writes a pipeline_moved activity", async () => {
    const res = await PATCH(...patch("c1", { pipelineStage: "contacted" }));
    expect((await res.json()).data.pipelineStage).toBe("contacted");
    const acts = await fakeDb.collection("contacts/c1/activities").get();
    expect(acts.size).toBe(1);
    expect(acts.docs[0].data()?.type).toBe("pipeline_moved");
    expect(acts.docs[0].data()?.createdBy).toMatch(/^agent:/);
  });

  it("rejects an unknown pipeline stage", async () => {
    const res = await PATCH(...patch("c1", { pipelineStage: "galaxy" }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test contact-detail`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/app/api/agent/v1/contacts/[id]/route.ts`**

```ts
import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { isValidEmail } from "@/lib/agent-api/contact-defaults";
import {
  requireServiceAuth,
  subAccountAllowed,
} from "@/lib/auth/require-service-auth";
import { PIPELINE_STAGES } from "@/types/deals";

async function loadAuthorizedContact(
  request: Request,
  id: string,
  scope: "contacts:read" | "contacts:write",
) {
  const access = await requireServiceAuth(request, { scope });
  if (access instanceof NextResponse) return access;

  const ref = getAdminDb().doc(`contacts/${id}`);
  const snap = await ref.get();
  if (!snap.exists) return agentError("NOT_FOUND", "Contact not found.", 404);
  const contact = snap.data() as Record<string, unknown>;
  if (!subAccountAllowed(access, contact.subAccountId as string)) {
    return agentError("SUB_ACCOUNT_FORBIDDEN", "Key cannot access this sub-account.", 403);
  }
  return { access, ref, contact };
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const loaded = await loadAuthorizedContact(request, id, "contacts:read");
  if (loaded instanceof NextResponse) return loaded;
  const { contact } = loaded;
  return NextResponse.json({
    data: {
      id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      company: contact.company,
      tags: contact.tags,
      pipelineStage: contact.pipelineStage,
      emailOptedOut: contact.emailOptedOut,
      smsOptedOut: contact.smsOptedOut,
      subAccountId: contact.subAccountId,
    },
  });
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    company?: string;
    phone?: string;
    email?: string;
    pipelineStage?: string;
    addTags?: string[];
    removeTags?: string[];
  } | null;
  if (!body) return agentError("VALIDATION_FAILED", "Invalid JSON body.", 400);

  if (body.pipelineStage !== undefined && !PIPELINE_STAGES.some((s) => s.id === body.pipelineStage)) {
    return agentError(
      "VALIDATION_FAILED",
      `Unknown pipelineStage. Valid: ${PIPELINE_STAGES.map((s) => s.id).join(", ")}.`,
      400,
    );
  }
  if (body.email !== undefined && body.email !== "" && !isValidEmail(body.email.trim().toLowerCase())) {
    return agentError("VALIDATION_FAILED", "Email format is invalid.", 400);
  }

  const loaded = await loadAuthorizedContact(request, id, "contacts:write");
  if (loaded instanceof NextResponse) return loaded;
  const { access, ref, contact } = loaded;

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (body.name !== undefined) update.name = body.name.trim();
  if (body.company !== undefined) update.company = body.company.trim();
  if (body.phone !== undefined) update.phone = body.phone.trim();
  if (body.email !== undefined) update.email = body.email.trim().toLowerCase();

  // Tags: read-modify-write (intentionally no FieldValue.arrayUnion — we
  // already hold the doc, and plain arrays are testable + ordered).
  if (body.addTags || body.removeTags) {
    const current = (contact.tags as string[]) ?? [];
    const removeSet = new Set((body.removeTags ?? []).map((t) => t.trim()));
    const next = current.filter((t) => !removeSet.has(t));
    for (const raw of body.addTags ?? []) {
      const t = raw.trim().slice(0, 50);
      if (t && !next.includes(t)) next.push(t);
    }
    update.tags = next;
  }

  const stageChanged =
    body.pipelineStage !== undefined && body.pipelineStage !== contact.pipelineStage;
  if (stageChanged) update.pipelineStage = body.pipelineStage;

  await ref.update(update);

  if (stageChanged) {
    await getAdminDb()
      .collection(`contacts/${id}/activities`)
      .add({
        type: "pipeline_moved",
        content: `Pipeline stage set to ${body.pipelineStage}`,
        createdBy: `agent:${access.keyPrefix}`,
        createdAt: FieldValue.serverTimestamp(),
      });
  }

  const after = await ref.get();
  const a = after.data() as Record<string, unknown>;
  return NextResponse.json({
    data: { id, tags: a.tags, pipelineStage: a.pipelineStage },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test contact-detail`
Expected: 5 passed.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add src/app/api/agent/v1/contacts src/app/api/agent/v1/__tests__/contact-detail.test.ts
git commit -m "feat(agent-api): contact get/patch with tag ops + stage activity"
```

---

### Task 9: Agent contacts import (batch)

**Files:**
- Create: `src/app/api/agent/v1/contacts/import/route.ts`
- Test: `src/app/api/agent/v1/__tests__/contacts-import.test.ts`

**Interfaces:**
- Consumes: `buildContactDoc`, `isValidEmail` (Task 7), `requireServiceAuth` (Task 4), `withIdempotency` (Task 6).
- Produces: `POST /api/agent/v1/contacts/import` body `{ subAccountId, contacts: AgentContactInput[] }` (max 200) → `201 { data: { created: number, skipped: [{ index, reason }] } }`. Row rule mirrors the CSV importer: **valid email OR phone required**; duplicate email in sub-account → skipped, not failed.

- [ ] **Step 1: Write the failing test**

`src/app/api/agent/v1/__tests__/contacts-import.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { POST } from "@/app/api/agent/v1/contacts/import/route";

let KEY: string;

beforeEach(() => {
  resetFakeDb();
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1", label: "t", keyHash: gen.keyHash, keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"], scopes: ["contacts:write"], status: "active",
  });
  KEY = gen.key;
});

function post(body: unknown): Request {
  return new Request("http://test/api/agent/v1/contacts/import", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("agent contacts import", () => {
  it("creates valid rows, skips invalid + duplicate rows with reasons", async () => {
    fakeDb.doc("contacts/existing").set({ subAccountId: "subMain", email: "dup@ex.com", tags: [] });
    const res = await POST(
      post({
        subAccountId: "subMain",
        contacts: [
          { name: "A", email: "a@ex.com", tags: ["box1"] },
          { name: "PhoneOnly", phone: "+14045550100" },
          { name: "Bad", email: "not-an-email" },
          { name: "Dup", email: "dup@ex.com" },
          { name: "Empty" },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const { created, skipped } = (await res.json()).data;
    expect(created).toBe(2);
    expect(skipped).toEqual([
      { index: 2, reason: "invalid_email" },
      { index: 3, reason: "duplicate_email" },
      { index: 4, reason: "missing_email_and_phone" },
    ]);
  });

  it("rejects more than 200 rows", async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({ phone: `+1404555${i}` }));
    const res = await POST(post({ subAccountId: "subMain", contacts: rows }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test contacts-import`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/app/api/agent/v1/contacts/import/route.ts`**

```ts
import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withIdempotency } from "@/lib/agent-api/idempotency";
import {
  buildContactDoc,
  isValidEmail,
  type AgentContactInput,
} from "@/lib/agent-api/contact-defaults";
import { requireServiceAuth } from "@/lib/auth/require-service-auth";

const MAX_ROWS = 200;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    subAccountId?: string;
    contacts?: AgentContactInput[];
  } | null;

  if (!body || typeof body.subAccountId !== "string" || !Array.isArray(body.contacts)) {
    return agentError("VALIDATION_FAILED", "subAccountId and contacts[] are required.", 400);
  }
  if (body.contacts.length === 0 || body.contacts.length > MAX_ROWS) {
    return agentError("VALIDATION_FAILED", `contacts[] must contain 1-${MAX_ROWS} rows.`, 400);
  }

  const access = await requireServiceAuth(request, {
    scope: "contacts:write",
    subAccountId: body.subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const contacts = body.contacts;
  return withIdempotency(request, access.keyId, async () => {
    const db = getAdminDb();
    let created = 0;
    const skipped: { index: number; reason: string }[] = [];
    // Also dedupe emails within the batch itself.
    const seenEmails = new Set<string>();

    for (let i = 0; i < contacts.length; i++) {
      const row = contacts[i];
      const email = row.email?.trim().toLowerCase() ?? "";
      const phone = row.phone?.trim() ?? "";

      if (!email && !phone) {
        skipped.push({ index: i, reason: "missing_email_and_phone" });
        continue;
      }
      // Same rule as the CSV importer: a malformed email on a phone-backed
      // row is dropped (row imports); without a phone it's a skip.
      if (email && !isValidEmail(email)) {
        if (phone) {
          row.email = "";
        } else {
          skipped.push({ index: i, reason: "invalid_email" });
          continue;
        }
      }
      const effectiveEmail = row.email?.trim().toLowerCase() ?? "";
      if (effectiveEmail) {
        if (seenEmails.has(effectiveEmail)) {
          skipped.push({ index: i, reason: "duplicate_email" });
          continue;
        }
        const dup = await db
          .collection("contacts")
          .where("subAccountId", "==", access.subAccountId)
          .where("email", "==", effectiveEmail)
          .limit(1)
          .get();
        if (!dup.empty) {
          skipped.push({ index: i, reason: "duplicate_email" });
          continue;
        }
        seenEmails.add(effectiveEmail);
      }

      await db.collection("contacts").add(buildContactDoc(access, row));
      created++;
    }

    return { status: 201, body: { data: { created, skipped } } };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test contacts-import`
Expected: 2 passed.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add src/app/api/agent/v1/contacts/import src/app/api/agent/v1/__tests__/contacts-import.test.ts
git commit -m "feat(agent-api): batch contact import with per-row skip reasons"
```

---

### Task 10: Agent deals — create + stage move

**Files:**
- Create: `src/app/api/agent/v1/deals/route.ts`
- Create: `src/app/api/agent/v1/deals/[id]/route.ts`
- Test: `src/app/api/agent/v1/__tests__/deals.test.ts`

**Interfaces:**
- Consumes: `requireServiceAuth`/`subAccountAllowed` (Task 4), `withIdempotency` (Task 6), `Deal`/`PIPELINE_STAGES`/`DealPriority` shapes from `@/types/deals`.
- Produces:
  - `POST /api/agent/v1/deals` body `{ subAccountId, contactId, title, value?, currency?, stageId?, priority? }` → `201 { data: { id } }`. Contact must exist in the same sub-account.
  - `PATCH /api/agent/v1/deals/[id]` body `{ title?, value?, stageId?, priority?, lostReason? }` → `{ data: { id, stageId } }`. A `stageId` change sets `stageChangedAt` and writes a `pipeline_moved` activity on the deal's contact.

- [ ] **Step 1: Write the failing test**

`src/app/api/agent/v1/__tests__/deals.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { POST } from "@/app/api/agent/v1/deals/route";
import { PATCH } from "@/app/api/agent/v1/deals/[id]/route";

let KEY: string;

beforeEach(() => {
  resetFakeDb();
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1", label: "t", keyHash: gen.keyHash, keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"], scopes: ["deals:write"], status: "active",
  });
  KEY = gen.key;
  fakeDb.doc("contacts/c1").set({
    name: "Ann", subAccountId: "subMain", agencyId: "ag1", tags: [],
    emailOptedOut: false, smsOptedOut: false,
  });
});

function post(body: unknown): Request {
  return new Request("http://test/api/agent/v1/deals", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("agent deals", () => {
  it("creates a deal with defaults", async () => {
    const res = await POST(post({ subAccountId: "subMain", contactId: "c1", title: "DFY $997" }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()).data;
    const deal = (await fakeDb.doc(`deals/${id}`).get()).data()!;
    expect(deal).toMatchObject({
      title: "DFY $997", value: 0, currency: "USD", contactId: "c1",
      stageId: "new", priority: "medium", agencyId: "ag1", subAccountId: "subMain",
      lostReason: null,
    });
    expect(deal.createdByUid).toMatch(/^agent:/);
  });

  it("404s when the contact is missing or in another sub-account", async () => {
    const res = await POST(post({ subAccountId: "subMain", contactId: "ghost", title: "X" }));
    expect(res.status).toBe(404);
  });

  it("moves stage, stamps stageChangedAt, writes contact activity", async () => {
    const createRes = await POST(post({ subAccountId: "subMain", contactId: "c1", title: "D" }));
    const { id } = (await createRes.json()).data;
    const res = await PATCH(
      new Request("http://test/x", {
        method: "PATCH",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ stageId: "qualified" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect((await res.json()).data.stageId).toBe("qualified");
    const deal = (await fakeDb.doc(`deals/${id}`).get()).data()!;
    expect(deal.stageChangedAt).toBeDefined();
    const acts = await fakeDb.collection("contacts/c1/activities").get();
    expect(acts.docs.some((d) => d.data()?.type === "pipeline_moved")).toBe(true);
  });

  it("rejects an invalid stageId", async () => {
    const createRes = await POST(post({ subAccountId: "subMain", contactId: "c1", title: "D" }));
    const { id } = (await createRes.json()).data;
    const res = await PATCH(
      new Request("http://test/x", {
        method: "PATCH",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ stageId: "warp" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/deals`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/app/api/agent/v1/deals/route.ts`**

```ts
import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withIdempotency } from "@/lib/agent-api/idempotency";
import { requireServiceAuth } from "@/lib/auth/require-service-auth";
import { DEAL_PRIORITIES, PIPELINE_STAGES } from "@/types/deals";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    subAccountId?: string;
    contactId?: string;
    title?: string;
    value?: number;
    currency?: string;
    stageId?: string;
    priority?: string;
  } | null;

  const title = body?.title?.trim();
  if (!body || typeof body.subAccountId !== "string" || typeof body.contactId !== "string" || !title) {
    return agentError("VALIDATION_FAILED", "subAccountId, contactId, and title are required.", 400);
  }
  const stageId = body.stageId ?? "new";
  if (!PIPELINE_STAGES.some((s) => s.id === stageId)) {
    return agentError("VALIDATION_FAILED", "Unknown stageId.", 400);
  }
  const priority = body.priority ?? "medium";
  if (!DEAL_PRIORITIES.some((p) => p.id === priority)) {
    return agentError("VALIDATION_FAILED", "Unknown priority.", 400);
  }

  const access = await requireServiceAuth(request, {
    scope: "deals:write",
    subAccountId: body.subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const db = getAdminDb();
  const contactSnap = await db.doc(`contacts/${body.contactId}`).get();
  if (!contactSnap.exists || contactSnap.data()?.subAccountId !== body.subAccountId) {
    return agentError("NOT_FOUND", "Contact not found in this sub-account.", 404);
  }

  const contactId = body.contactId;
  const value = typeof body.value === "number" && body.value >= 0 ? body.value : 0;
  const currency = body.currency?.trim() || "USD";

  return withIdempotency(request, access.keyId, async () => {
    const ref = await db.collection("deals").add({
      title,
      value,
      currency,
      contactId,
      stageId,
      priority,
      agencyId: access.agencyId,
      subAccountId: access.subAccountId,
      createdByUid: `agent:${access.keyPrefix}`,
      lostReason: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      stageChangedAt: FieldValue.serverTimestamp(),
    });
    return { status: 201, body: { data: { id: ref.id } } };
  });
}
```

- [ ] **Step 4: Write `src/app/api/agent/v1/deals/[id]/route.ts`**

```ts
import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import {
  requireServiceAuth,
  subAccountAllowed,
} from "@/lib/auth/require-service-auth";
import { DEAL_PRIORITIES, PIPELINE_STAGES, getStage } from "@/types/deals";

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as {
    title?: string;
    value?: number;
    stageId?: string;
    priority?: string;
    lostReason?: string | null;
  } | null;
  if (!body) return agentError("VALIDATION_FAILED", "Invalid JSON body.", 400);
  if (body.stageId !== undefined && !PIPELINE_STAGES.some((s) => s.id === body.stageId)) {
    return agentError("VALIDATION_FAILED", "Unknown stageId.", 400);
  }
  if (body.priority !== undefined && !DEAL_PRIORITIES.some((p) => p.id === body.priority)) {
    return agentError("VALIDATION_FAILED", "Unknown priority.", 400);
  }

  const access = await requireServiceAuth(request, { scope: "deals:write" });
  if (access instanceof NextResponse) return access;

  const db = getAdminDb();
  const ref = db.doc(`deals/${id}`);
  const snap = await ref.get();
  if (!snap.exists) return agentError("NOT_FOUND", "Deal not found.", 404);
  const deal = snap.data() as Record<string, unknown>;
  if (!subAccountAllowed(access, deal.subAccountId as string)) {
    return agentError("SUB_ACCOUNT_FORBIDDEN", "Key cannot access this sub-account.", 403);
  }

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (body.title !== undefined && body.title.trim()) update.title = body.title.trim();
  if (typeof body.value === "number" && body.value >= 0) update.value = body.value;
  if (body.priority !== undefined) update.priority = body.priority;
  if (body.lostReason !== undefined) update.lostReason = body.lostReason;

  const stageChanged = body.stageId !== undefined && body.stageId !== deal.stageId;
  if (stageChanged) {
    update.stageId = body.stageId;
    update.stageChangedAt = FieldValue.serverTimestamp();
  }

  await ref.update(update);

  if (stageChanged) {
    await db.collection(`contacts/${deal.contactId as string}/activities`).add({
      type: "pipeline_moved",
      content: `Deal "${deal.title as string}" moved to ${getStage(body.stageId).label}`,
      createdBy: `agent:${access.keyPrefix}`,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  const after = await ref.get();
  return NextResponse.json({ data: { id, stageId: after.data()?.stageId } });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test __tests__/deals`
Expected: 4 passed.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add src/app/api/agent/v1/deals src/app/api/agent/v1/__tests__/deals.test.ts
git commit -m "feat(agent-api): deal create + stage move with contact activity"
```

---

### Task 11: Agent templates — list/create/get/patch

**Files:**
- Create: `src/app/api/agent/v1/templates/route.ts`
- Create: `src/app/api/agent/v1/templates/[id]/route.ts`
- Test: `src/app/api/agent/v1/__tests__/templates.test.ts`

**Interfaces:**
- Consumes: `requireServiceAuth`/`subAccountAllowed` (Task 4), `validateEmailBody` from `@/lib/automations/merge-tags` (existing — returns `string | null`, an error message or null), `MessageTemplateDoc` shape from `@/types/automations`.
- Produces:
  - `GET /api/agent/v1/templates?subAccountId=...&type=email` → `{ data: [{ id, type, name, subject, body }] }`
  - `POST /api/agent/v1/templates` body `{ subAccountId, type: "email"|"sms", name, subject?, body }` → `201 { data: { id } }`. Email templates: `subject` required and `validateEmailBody(body)` must return null (it enforces the `{{unsubscribeLink}}` requirement).
  - `GET`/`PATCH /api/agent/v1/templates/[id]` — PATCH accepts `{ name?, subject?, body? }`, re-validating email bodies.

- [ ] **Step 1: Write the failing test**

`src/app/api/agent/v1/__tests__/templates.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/templates`
Expected: FAIL — modules not found. (If `validateEmailBody`'s actual unsubscribe requirement differs from `{{unsubscribeLink}}`, read `src/lib/automations/merge-tags.ts:120` and adjust `VALID_EMAIL_BODY` in the test to satisfy it — the route code below stays the same.)

- [ ] **Step 3: Write `src/app/api/agent/v1/templates/route.ts`**

```ts
import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { requireServiceAuth } from "@/lib/auth/require-service-auth";
import { validateEmailBody } from "@/lib/automations/merge-tags";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const subAccountId = url.searchParams.get("subAccountId");
  if (!subAccountId) {
    return agentError("VALIDATION_FAILED", "subAccountId query param is required.", 400);
  }
  const access = await requireServiceAuth(request, {
    scope: "templates:read",
    subAccountId,
  });
  if (access instanceof NextResponse) return access;

  let q = getAdminDb()
    .collection("message_templates")
    .where("subAccountId", "==", subAccountId);
  const type = url.searchParams.get("type");
  if (type) q = q.where("type", "==", type);

  const snap = await q.limit(100).get();
  const data = snap.docs.map((d) => {
    const t = d.data();
    return { id: d.id, type: t.type, name: t.name, subject: t.subject ?? null, body: t.body };
  });
  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    subAccountId?: string;
    type?: string;
    name?: string;
    subject?: string;
    body?: string;
  } | null;

  const name = body?.name?.trim();
  const templateBody = body?.body?.trim();
  if (
    !body ||
    typeof body.subAccountId !== "string" ||
    (body.type !== "email" && body.type !== "sms") ||
    !name ||
    !templateBody
  ) {
    return agentError(
      "VALIDATION_FAILED",
      'subAccountId, type ("email"|"sms"), name, and body are required.',
      400,
    );
  }
  const subject = body.subject?.trim() ?? null;
  if (body.type === "email") {
    if (!subject) {
      return agentError("VALIDATION_FAILED", "subject is required for email templates.", 400);
    }
    const err = validateEmailBody(templateBody);
    if (err) return agentError("VALIDATION_FAILED", err, 400);
  }

  const access = await requireServiceAuth(request, {
    scope: "templates:write",
    subAccountId: body.subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const ref = await getAdminDb().collection("message_templates").add({
    agencyId: access.agencyId,
    subAccountId: access.subAccountId,
    type: body.type,
    name,
    subject: body.type === "email" ? subject : null,
    body: templateBody,
    createdByUid: `agent:${access.keyPrefix}`,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return NextResponse.json({ data: { id: ref.id } }, { status: 201 });
}
```

- [ ] **Step 4: Write `src/app/api/agent/v1/templates/[id]/route.ts`**

```ts
import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import {
  requireServiceAuth,
  subAccountAllowed,
} from "@/lib/auth/require-service-auth";
import { validateEmailBody } from "@/lib/automations/merge-tags";

async function loadAuthorizedTemplate(
  request: Request,
  id: string,
  scope: "templates:read" | "templates:write",
) {
  const access = await requireServiceAuth(request, { scope });
  if (access instanceof NextResponse) return access;
  const ref = getAdminDb().doc(`message_templates/${id}`);
  const snap = await ref.get();
  if (!snap.exists) return agentError("NOT_FOUND", "Template not found.", 404);
  const template = snap.data() as Record<string, unknown>;
  if (!subAccountAllowed(access, template.subAccountId as string)) {
    return agentError("SUB_ACCOUNT_FORBIDDEN", "Key cannot access this sub-account.", 403);
  }
  return { access, ref, template };
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const loaded = await loadAuthorizedTemplate(request, id, "templates:read");
  if (loaded instanceof NextResponse) return loaded;
  const { template } = loaded;
  return NextResponse.json({
    data: {
      id,
      type: template.type,
      name: template.name,
      subject: template.subject ?? null,
      body: template.body,
    },
  });
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    subject?: string;
    body?: string;
  } | null;
  if (!body) return agentError("VALIDATION_FAILED", "Invalid JSON body.", 400);

  const loaded = await loadAuthorizedTemplate(request, id, "templates:write");
  if (loaded instanceof NextResponse) return loaded;
  const { ref, template } = loaded;

  const nextBody = body.body?.trim() ?? (template.body as string);
  if (template.type === "email") {
    const err = validateEmailBody(nextBody);
    if (err) return agentError("VALIDATION_FAILED", err, 400);
  }

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (body.name !== undefined && body.name.trim()) update.name = body.name.trim();
  if (body.subject !== undefined) update.subject = body.subject.trim();
  if (body.body !== undefined) update.body = nextBody;

  await ref.update(update);
  return NextResponse.json({ data: { id } });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test __tests__/templates`
Expected: 4 passed.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add src/app/api/agent/v1/templates src/app/api/agent/v1/__tests__/templates.test.ts
git commit -m "feat(agent-api): template CRUD with email body validation"
```

---

### Task 12: Agent one-off email send

**Files:**
- Create: `src/app/api/agent/v1/messages/email/route.ts`
- Test: `src/app/api/agent/v1/__tests__/messages-email.test.ts`

**Interfaces:**
- Consumes: `requireServiceAuth`/`subAccountAllowed` (Task 4), `enforceDailyCap` (Task 6), `withIdempotency` (Task 6), existing `sendEmail`/`emailIsConfigured` from `@/lib/comms/resend`, `recordSend` from `@/lib/comms/usage`.
- Produces: `POST /api/agent/v1/messages/email` body `{ contactId, subject, body }` → `{ data: { id } }` (Resend message id). Guards in order: email configured → auth+scope `sends:execute` → contact exists → sub-account allowed → contact has email → **`emailOptedOut` → 409 CONTACT_OPTED_OUT** → daily cap (100) → idempotency → send → `email_sent` activity with `createdBy: "agent:<keyPrefix>"` → `recordSend("agent:<keyPrefix>", "email")`.
- Daily send cap constant: `const DAILY_SEND_CAP = 100;`

- [ ] **Step 1: Write the failing test**

`src/app/api/agent/v1/__tests__/messages-email.test.ts`:

```ts
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
  sendEmail: (args: unknown) => sendEmailMock(args),
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test messages-email`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/app/api/agent/v1/messages/email/route.ts`**

```ts
import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { enforceDailyCap } from "@/lib/agent-api/caps";
import { withIdempotency } from "@/lib/agent-api/idempotency";
import {
  requireServiceAuth,
  subAccountAllowed,
} from "@/lib/auth/require-service-auth";
import { emailIsConfigured, sendEmail } from "@/lib/comms/resend";
import { recordSend } from "@/lib/comms/usage";

const DAILY_SEND_CAP = 100;

export async function POST(request: Request) {
  if (!emailIsConfigured()) {
    return agentError("SEND_FAILED", "Email is not configured on this deployment.", 503);
  }

  const body = (await request.json().catch(() => null)) as {
    contactId?: string;
    subject?: string;
    body?: string;
  } | null;
  const contactId = body?.contactId?.trim();
  const subject = body?.subject?.trim();
  const text = body?.body?.trim();
  if (!contactId || !subject || !text) {
    return agentError("VALIDATION_FAILED", "contactId, subject, and body are required.", 400);
  }

  const access = await requireServiceAuth(request, { scope: "sends:execute" });
  if (access instanceof NextResponse) return access;

  const db = getAdminDb();
  const contactSnap = await db.doc(`contacts/${contactId}`).get();
  if (!contactSnap.exists) return agentError("NOT_FOUND", "Contact not found.", 404);
  const contact = contactSnap.data() as Record<string, unknown>;
  if (!subAccountAllowed(access, contact.subAccountId as string)) {
    return agentError("SUB_ACCOUNT_FORBIDDEN", "Key cannot access this sub-account.", 403);
  }
  if (!contact.email) {
    return agentError("VALIDATION_FAILED", "This contact has no email address.", 400);
  }
  if (contact.emailOptedOut === true) {
    return agentError("CONTACT_OPTED_OUT", "Contact has opted out of email.", 409);
  }

  const capped = await enforceDailyCap(access.keyId, "sends", DAILY_SEND_CAP);
  if (capped) return capped;

  return withIdempotency(request, access.keyId, async () => {
    const subSnap = await db
      .doc(`subAccounts/${contact.subAccountId as string}`)
      .get();
    const replyTo =
      (subSnap.data()?.replyToEmail as string | null | undefined) ?? undefined;

    let messageId: string;
    try {
      const result = await sendEmail({
        to: contact.email as string,
        subject,
        text,
        replyTo,
      });
      messageId = result.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send email";
      return { status: 502, body: { error: { code: "SEND_FAILED", message } } };
    }

    try {
      await db.collection(`contacts/${contactId}/activities`).add({
        type: "email_sent",
        content: `Email: ${subject}`,
        createdBy: `agent:${access.keyPrefix}`,
        meta: { messageId, subject },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.warn("[agent email] activity write failed", err);
    }

    await recordSend(`agent:${access.keyPrefix}`, "email");
    return { status: 200, body: { data: { id: messageId } } };
  });
}
```

Note: if `recordSend`'s signature rejects a non-uid first argument at the type level, read `src/lib/comms/usage.ts` and match its actual signature — the intent is metering under the synthetic actor id `agent:<keyPrefix>`; if it hard-requires a real uid, meter under the key's `createdByUid` instead and note it in the commit message.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test messages-email`
Expected: 4 passed.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add src/app/api/agent/v1/messages src/app/api/agent/v1/__tests__/messages-email.test.ts
git commit -m "feat(agent-api): one-off email send with opt-out check, cap, idempotency"
```

---

### Task 13: Agent reports summary

**Files:**
- Create: `src/app/api/agent/v1/reports/summary/route.ts`
- Test: `src/app/api/agent/v1/__tests__/reports.test.ts`

**Interfaces:**
- Consumes: `requireServiceAuth` (Task 4).
- Produces: `GET /api/agent/v1/reports/summary?subAccountId=...` (scope `reports:read`) →
  ```json
  { "data": {
      "contacts": { "total": 0, "byStage": {}, "emailOptedOut": 0 },
      "deals": { "total": 0, "byStage": {}, "valueByStage": {} }
  } }
  ```
  Reads are capped at 5000 docs per collection with `.select()` projections (fine at current scale; revisit with count() aggregates if Main outgrows it).

- [ ] **Step 1: Write the failing test**

`src/app/api/agent/v1/__tests__/reports.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import { generateServiceKey } from "@/lib/agent-api/keys";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

import { GET } from "@/app/api/agent/v1/reports/summary/route";

let KEY: string;

beforeEach(() => {
  resetFakeDb();
  const gen = generateServiceKey();
  fakeDb.doc("agencyServiceKeys/key1").set({
    agencyId: "ag1", label: "t", keyHash: gen.keyHash, keyPrefix: gen.keyPrefix,
    allowedSubAccounts: ["subMain"], scopes: ["reports:read"], status: "active",
  });
  KEY = gen.key;
  fakeDb.doc("contacts/c1").set({ subAccountId: "subMain", pipelineStage: "new", emailOptedOut: false, tags: [] });
  fakeDb.doc("contacts/c2").set({ subAccountId: "subMain", pipelineStage: "contacted", emailOptedOut: true, tags: [] });
  fakeDb.doc("contacts/c3").set({ subAccountId: "subOther", pipelineStage: "new", emailOptedOut: false, tags: [] });
  fakeDb.doc("deals/d1").set({ subAccountId: "subMain", stageId: "qualified", value: 997 });
});

describe("agent reports summary", () => {
  it("aggregates contacts and deals for the sub-account", async () => {
    const res = await GET(
      new Request("http://test/api/agent/v1/reports/summary?subAccountId=subMain", {
        headers: { authorization: `Bearer ${KEY}` },
      }),
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.contacts).toEqual({
      total: 2,
      byStage: { new: 1, contacted: 1 },
      emailOptedOut: 1,
    });
    expect(data.deals).toEqual({
      total: 1,
      byStage: { qualified: 1 },
      valueByStage: { qualified: 997 },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/reports`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/app/api/agent/v1/reports/summary/route.ts`**

```ts
import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { requireServiceAuth } from "@/lib/auth/require-service-auth";

const MAX_DOCS = 5000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const subAccountId = url.searchParams.get("subAccountId");
  if (!subAccountId) {
    return agentError("VALIDATION_FAILED", "subAccountId query param is required.", 400);
  }
  const access = await requireServiceAuth(request, {
    scope: "reports:read",
    subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const db = getAdminDb();
  const [contactsSnap, dealsSnap] = await Promise.all([
    db
      .collection("contacts")
      .where("subAccountId", "==", subAccountId)
      .select("pipelineStage", "emailOptedOut")
      .limit(MAX_DOCS)
      .get(),
    db
      .collection("deals")
      .where("subAccountId", "==", subAccountId)
      .select("stageId", "value")
      .limit(MAX_DOCS)
      .get(),
  ]);

  const byStage: Record<string, number> = {};
  let emailOptedOut = 0;
  for (const d of contactsSnap.docs) {
    const c = d.data();
    const stage = (c.pipelineStage as string) ?? "none";
    byStage[stage] = (byStage[stage] ?? 0) + 1;
    if (c.emailOptedOut === true) emailOptedOut++;
  }

  const dealsByStage: Record<string, number> = {};
  const valueByStage: Record<string, number> = {};
  for (const d of dealsSnap.docs) {
    const deal = d.data();
    const stage = (deal.stageId as string) ?? "none";
    dealsByStage[stage] = (dealsByStage[stage] ?? 0) + 1;
    valueByStage[stage] = (valueByStage[stage] ?? 0) + ((deal.value as number) ?? 0);
  }

  return NextResponse.json({
    data: {
      contacts: { total: contactsSnap.size, byStage, emailOptedOut },
      deals: { total: dealsSnap.size, byStage: dealsByStage, valueByStage },
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/reports`
Expected: 1 passed.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add src/app/api/agent/v1/reports src/app/api/agent/v1/__tests__/reports.test.ts
git commit -m "feat(agent-api): reports summary endpoint"
```

---

### Task 14: Full verification, live smoke, API reference doc

**Files:**
- Create: `docs/AGENT_API.md`
- No source changes expected (fixes only if verification finds problems).

- [ ] **Step 1: Full suite + lint + typecheck**

```bash
pnpm test && pnpm exec tsc --noEmit && pnpm lint
```

Expected: all tests pass, no type errors, no new lint **errors** (the repo baseline has warnings; don't add errors).

- [ ] **Step 2: Build check**

Run: `pnpm build`
Expected: production build completes. This catches `"server-only"` import violations and route-handler signature mistakes that unit tests can't.

- [ ] **Step 3: Live smoke against the dev server (careful — real Firestore)**

`.env.local` points at production Firebase; do NOT touch real contacts. The smoke uses a throwaway contact tagged `bridge-smoke` and deletes it after.

```bash
# Terminal 1
pnpm dev

# Terminal 2 — mint a smoke key scoped to the Main sub-account
node scripts/mint-service-key.mjs --label smoke-test \
  --sub-account DDEParISNUlxoMiimi2X \
  --scopes contacts:read,contacts:write,reports:read
# copy the plaintext key into $KEY, then:

# 1. create
curl -s -X POST http://localhost:3000/api/agent/v1/contacts \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"subAccountId":"DDEParISNUlxoMiimi2X","name":"Bridge Smoke","email":"bridge-smoke@example.com","tags":["bridge-smoke"]}'
# expect: {"data":{"id":"..."}}

# 2. search
curl -s "http://localhost:3000/api/agent/v1/contacts?subAccountId=DDEParISNUlxoMiimi2X&tag=bridge-smoke" \
  -H "Authorization: Bearer $KEY"
# expect: the contact, with emailOptedOut:false

# 3. bad key is rejected
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/agent/v1/contacts?subAccountId=DDEParISNUlxoMiimi2X" \
  -H "Authorization: Bearer ugl_0000000000000000000000000000000000000000"
# expect: 401

# 4. reports
curl -s "http://localhost:3000/api/agent/v1/reports/summary?subAccountId=DDEParISNUlxoMiimi2X" \
  -H "Authorization: Bearer $KEY"
```

Then clean up: delete the smoke contact from the dashboard (Contacts → search `bridge-smoke` → delete) and revoke the smoke key by setting its doc `status: "revoked"` (Firebase console) or via the DELETE route from a logged-in session. Record any composite-index prompts Firestore raised and the index links used.

- [ ] **Step 4: Write `docs/AGENT_API.md`**

A one-page reference for the Phase 3 MCP server: base URL (`https://app.ugotleads.io`), auth header format, the endpoint table from the spec (Phase 1 rows only, marked with scopes and request/response examples copied from the tests above), error code list from `src/lib/agent-api/errors.ts`, cap values, and the idempotency-key convention. Source the endpoint list from the actual route files, not from memory.

- [ ] **Step 5: Final commit**

```bash
git add docs/AGENT_API.md
git commit -m "docs: agent API v1 reference for MCP bridge (phase 3 input)"
```

- [ ] **Step 6: Report completion to Star**

Summarize: branch name, test count, smoke results, any Firestore indexes created, and the explicit note that **nothing is deployed** — deploying `feature/agent-bridge-phase1` to Vercel prod is her call (governance PAUSE tier).

---

## Self-Review Notes (already applied)

- **Spec coverage:** 4.1 service auth → Tasks 2, 4, 5. 4.2 routes: contacts (7, 8, 9), deals (10), templates (11), one-off email (12), reports (13); audit stamping in every route; idempotency + caps (6). Section 6 security → scoped keys (4, 5), caps (6, 12), opt-out (12). Section 7 errors → Task 1 envelope, per-route codes, partial-success import (9). Section 8 testing → per-task units + Task 14 integration/smoke. Sequences/enroll/replies rows in the spec's 4.2 table are Phase 2 by the spec's own phasing — intentionally absent.
- **Deviations from spec (documented):** SMS one-off route deferred (Twilio A2P pending; `smsIsConfigured()` false in prod). `templates:read` scope added (spec's scope list was illustrative). CLI mint script added alongside the owner route so the first key doesn't require a browser-session workaround.
- **Type consistency check:** `AgentAccess` (Task 4) is consumed by name in Tasks 7–13; `agentError` codes used in routes all exist in Task 1's union (`CONTACT_OPTED_OUT`, `SEND_FAILED` included); `buildContactDoc`/`isValidEmail` signatures match between Task 7 definition and Task 9 use; fake-db API used in tests matches Task 3's implementation (`set/get/update/delete/where/limit/add/runTransaction/select`).
