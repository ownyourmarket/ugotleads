# PromptExpert Phase 3 (GPTs) + Marketing Route + Credit Top-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship GPTs (saved chat assistants with per-message credit billing), a public `/promptexpert` marketing page, and the credit top-up purchase flow (Stripe → wallet).

**Architecture:** Extends the merged Phases 1–2 module (`src/lib/promptexpert/`, `pe_*` collections). GPT chat reuses the proven charge-ladder pattern via a new dependency-injected `run-gpt-message.ts` engine. Top-up adds a `kind: "credit_topup"` Stripe checkout (inline `price_data`, no SKU management) + a webhook fulfillment branch that mints wallet credits **with `subAccountId` stamped**. Marketing page is a public top-level route.

**Tech Stack:** Same as Phases 1–2 (Next.js 15, Firebase, shadcn base-nova, vitest) + existing Stripe integration (`src/lib/stripe/webhooks.ts`).

**Design spec:** `docs/2026-07-05-promptexpert-design.md` §5 (GPTs) + this plan's Decisions block.

## Decisions (Star, 2026-07-11 — binding)

- **Credit packs:** Starter **500 credits / $19** · Growth **2,000 / $49** · Scale **5,000 / $99**. One-time payments, inline `price_data` (no pre-created Stripe SKUs).
- **GPT chat pricing:** `creditCostPerMessage` per GPT, **default 1**, builder-adjustable, integer ≥ 0. Same charge ladder as skills (master exempt → credit-mode charged → byok gated by `featurePromptExpert` → subscription/null included).
- **Wallet ownership on top-up:** wallet doc id = purchasing user's uid (house convention: doc id === partnerProfileId), and the fulfillment MUST stamp `subAccountId` (the run route's wallet lookup depends on it — the auto-create path's `subAccountId: null` is exactly the bug we must not ship).
- **Public GPTs:** still out of scope (design §5).

## Global Constraints

- All tenant docs carry BOTH `agencyId` and `subAccountId`; rules lock them on update via `tenantFieldsLockedOnUpdate()`.
- Master exemption keys ONLY off `process.env.MASTER_AGENCY_ID`; never role claims. Unset ⇒ nobody exempt.
- Charge-then-run; refund type `"refund"` on failure after charge; `planMode: null` = included-with-cap (pinned decision).
- `pe_` collection prefix; client delete denied; `pe_gpts` and `pe_gpt_sessions` writes are SERVER-ONLY (rules `allow write: if false`) — all mutations via API routes (design §3: ref arrays must be same-tenant-validated server-side).
- Native `<select>` (no shadcn Select exists); design tokens; `render={<Link/>}` button-link pattern; `aria-required` on mandatory fields; every fetch-driven panel guards stale responses (generation-ref pattern from the skills page).
- Engines are pure/DI'd (no firebase imports) with vitest coverage; routes use `requireSubAccountMember`/`requireSubAccountAdmin` + `instanceof NextResponse` early-return.
- Stripe: new checkout sessions carry `metadata.kind = "credit_topup"`; webhook fulfillment must be idempotent per Stripe session id.
- `pnpm tsc --noEmit`, `pnpm lint`, `pnpm vitest run`, `pnpm build` all clean before finish.
- **⚠ CHECKPOINT (ask Star):** deploying rules (union with any unmerged branches — check `git diff main <branch> -- firestore.rules` for every open branch first); any Stripe LIVE-mode purchase test.

---

## File Structure

```
src/types/promptexpert.ts                                   # + PeGpt, PeGptSession, PeGptMessage, CREDIT_PACKS   (T1)
firestore.rules                                             # + pe_gpts, pe_gpt_sessions                          (T2)
src/lib/promptexpert/gpt-prompt.ts                          # pure: assemble GPT system prompt                    (T3)
src/lib/promptexpert/run-gpt-message.ts                     # DI engine: charge ladder + chat turn                (T4)
src/lib/promptexpert/__tests__/gpt-prompt.test.ts           #                                                     (T3)
src/lib/promptexpert/__tests__/run-gpt-message.test.ts      #                                                     (T4)
src/app/api/sub-accounts/[id]/promptexpert/gpts/route.ts    # POST create / PATCH update (server-validated refs)  (T5)
src/app/api/sub-accounts/[id]/promptexpert/gpts/[gptId]/chat/route.ts  # POST chat message                        (T6)
src/lib/firestore/promptexpert.ts                           # + subscribeToPeGpts, subscribeToPeGptSessions       (T5)
src/app/(dashboard)/sa/[subAccountId]/promptexpert/gpts/page.tsx        # builder list + editor sheet             (T7)
src/app/(dashboard)/sa/[subAccountId]/promptexpert/gpts/[gptId]/page.tsx # chat screen                            (T8)
src/components/dashboard/sidebar.tsx                        # (no change — /promptexpert prefix already matches)
src/app/promptexpert/page.tsx                               # public marketing page                               (T9)
src/middleware.ts                                           # + "/promptexpert" in PUBLIC_PATHS                   (T9)
src/app/api/credits/topup/checkout/route.ts                 # POST create Stripe session                          (T10)
src/lib/credits/topup.ts                                    # fulfillTopup() — idempotent mint w/ subAccountId    (T11)
src/lib/credits/__tests__/topup.test.ts                     #                                                     (T11)
src/lib/stripe/webhooks.ts                                  # + kind "credit_topup" branch → fulfillTopup         (T11)
src/app/(dashboard)/sa/[subAccountId]/credits/page.tsx      # + Buy-credits panel (3 packs)                       (T12)
src/lib/fulfillment/grant-entitlement.ts                    # + featurePromptExpert hook                          (T13)
```

---

### Task 1: Types + credit pack constants

**Files:** Modify `src/types/promptexpert.ts` (append; do not touch existing exports)

**Interfaces produced (verbatim names later tasks rely on):**

```ts
export interface CreditPack {
  id: "starter" | "growth" | "scale";
  name: string;
  credits: number;
  priceUsdCents: number;   // one-time
}
export const CREDIT_PACKS: CreditPack[] = [
  { id: "starter", name: "Starter", credits: 500,  priceUsdCents: 1900 },
  { id: "growth",  name: "Growth",  credits: 2000, priceUsdCents: 4900 },
  { id: "scale",   name: "Scale",   credits: 5000, priceUsdCents: 9900 },
];

/** Saved assistant. Collection: pe_gpts/{id}. SERVER-WRITTEN ONLY. */
export interface PeGpt {
  id: string;
  agencyId: string;
  subAccountId: string;
  name: string;
  description: string | null;
  basePromptId: string | null;      // pe_prompts ref, same-tenant validated server-side
  pinnedGemIds: string[];           // pe_gems refs, same-tenant validated
  allowedSkillIds: string[];        // pe_skills refs (reserved for later tool-use), same-tenant validated
  creditCostPerMessage: number;     // int >= 0, default 1
  createdByUid: string;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

export interface PeGptMessage { role: "user" | "assistant"; content: string; at: number /* epoch ms */; }
export const PE_GPT_SESSION_MAX_MESSAGES = 40;   // ring buffer cap, oldest dropped

/** Chat session. Collection: pe_gpt_sessions/{id}. SERVER-WRITTEN ONLY. */
export interface PeGptSession {
  id: string;
  agencyId: string;
  subAccountId: string;
  gptId: string;
  startedByUid: string;
  messages: PeGptMessage[];         // capped at PE_GPT_SESSION_MAX_MESSAGES
  totalCreditsCharged: number;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}
```

**Steps:** append the block above verbatim → `pnpm tsc --noEmit` clean → commit `feat(promptexpert): GPT + credit pack types`.

---

### Task 2: Firestore rules for pe_gpts / pe_gpt_sessions

**Files:** Modify `firestore.rules` (adjacent to the existing `pe_skills` block; reuse helpers)

```
    match /pe_gpts/{id} {
      allow read:   if canAccessSub(resource.data.subAccountId, resource.data.agencyId);
      allow write:  if false;   // server-validated ref arrays — API only
    }

    match /pe_gpt_sessions/{id} {
      allow read:   if canAccessSub(resource.data.subAccountId, resource.data.agencyId);
      allow write:  if false;   // server-appended chat turns — API only
    }
```

**Steps:** insert (inside documents scope, before catch-all) → `grep -n "pe_gpts\|pe_skills" firestore.rules` placement check → commit `feat(promptexpert): rules for pe_gpts/pe_gpt_sessions` → **deploy is a CHECKPOINT at the end, not now** (chat manual testing needs it deployed — coordinate with controller).

---

### Task 3: GPT prompt assembly (pure, TDD)

**Files:** Create `src/lib/promptexpert/gpt-prompt.ts` + test.

**Contract (T4/T6 consume):**

```ts
export interface GptPromptInput {
  basePromptContent: string | null;          // resolved pe_prompts content, or null
  gptName: string;
  gems: Array<{ name: string; dataContent: string }>;   // the PINNED gems, already loaded
}
export function buildGptSystemPrompt(input: GptPromptInput): string;
```

Behavior (write the tests first — 4 cases):
1. With base prompt + gems: output = basePromptContent, then a blank line, then for each gem `--- Context: <name> ---\n<dataContent>\n--- End context ---` blocks (same delimiters as `resolve-mentions.ts`), then the standing footer line `You are "<gptName>". Stay in character and use the context above.`
2. Null basePromptContent → output starts with `You are "<gptName>"...` footer preceded by the gem blocks (no leading blank junk).
3. Empty gems → no context blocks, no stray blank lines (assert no `\n\n\n`).
4. Pure module: no imports beyond types (assert via review, not test).

**Steps:** TDD (tests → RED → implement → GREEN 4/4) → commit `feat(promptexpert): GPT system prompt assembly`.

---

### Task 4: Chat engine `run-gpt-message.ts` (DI, TDD — the billing core)

**Files:** Create `src/lib/promptexpert/run-gpt-message.ts` + test. Read `src/lib/promptexpert/run-skill.ts` FIRST — this engine mirrors its charge ladder exactly; reuse its idioms, do not import firebase.

**Contract:**

```ts
export interface RunGptDeps {
  loadSubAccount(subAccountId: string): Promise<{ agencyId: string; planMode: "credit" | "subscription" | "byok" | null; featurePromptExpert?: boolean } | null>;
  loadGpt(gptId: string): Promise<{ id: string; subAccountId: string; name: string; basePromptId: string | null; pinnedGemIds: string[]; creditCostPerMessage: number } | null>;
  loadPromptContent(promptId: string): Promise<string | null>;        // pe_prompts content, null if missing
  loadGemsByIds(ids: string[]): Promise<Array<{ name: string; dataContent: string }>>;
  loadSession(sessionId: string): Promise<{ id: string; gptId: string; subAccountId: string; messages: Array<{ role: "user" | "assistant"; content: string; at: number }> } | null>;
  createSession(data: Record<string, unknown>): Promise<string>;      // returns new session id
  appendToSession(sessionId: string, patch: Record<string, unknown>): Promise<void>;
  newMessageId(): string;                                             // for charge idempotency
  charge(input: { agencyId: string; subAccountId: string; amount: number; operationId: string; reason: string }): Promise<
    | { ok: true; transactionId: string } | { skipped: true }
    | { insufficient_balance: true; currentBalance: number; required: number }
    | { wallet_not_found: true } | { error: true; message: string }>;
  refund(input: { agencyId: string; subAccountId: string; amount: number; referenceId: string }): Promise<void>;
  resolveAi(subAccountId: string): Promise<{ apiKey: string; recordUsage(t: number): Promise<void> }>;
  callModel(input: { apiKey: string; messages: Array<{ role: "system" | "user" | "assistant"; content: string }> }): Promise<{ text: string; totalTokens: number; model: string }>;
  now(): number;                                                      // epoch ms (injected — engines stay clock-pure)
  masterAgencyId: string | undefined;
}

export type RunGptResult =
  | { ok: true; sessionId: string; reply: string; creditsCharged: number; model: string }
  | { status: 402; currentBalance: number; required: number }
  | { status: 403; upsell: true }
  | { status: 404; error: string }
  | { status: 429; error: "token_cap" }
  | { status: 500; error: string };

export function runGptMessage(deps: RunGptDeps, input: {
  subAccountId: string; uid: string; gptId: string;
  sessionId: string | null;          // null = start new session
  userMessage: string;
}): Promise<RunGptResult>;
```

Engine flow (mirror run-skill.ts structure):
1. Load sub → 404 if missing. Load gpt → 404 if missing or `gpt.subAccountId !== input.subAccountId`.
2. If sessionId given: load session → 404 if missing, or if `session.gptId !== gptId` or `session.subAccountId !== input.subAccountId`.
3. Master check (env only) → byok gate (`featurePromptExpert !== true` → 403) — before ANY write/charge.
4. `messageId = deps.newMessageId()`, `operationId = "gpt_msg_" + messageId"`. Charge ladder identical to run-skill (`shouldCharge = !isMaster && planMode === "credit" && creditCostPerMessage > 0`); 402/500 paths identical; `skipped` continues uncharged.
5. Build system prompt: `buildGptSystemPrompt({ basePromptContent: gpt.basePromptId ? await loadPromptContent(...) : null, gptName: gpt.name, gems: await loadGemsByIds(gpt.pinnedGemIds) })`.
6. Messages array: `[{role:"system",content:sys}, ...history(last PE_GPT_SESSION_MAX_MESSAGES), {role:"user",content:userMessage}]`.
7. `callModel` inside try; on throw → refund if charged (CapExceededError name → 429, else 500) — identical to run-skill.
8. Post-success bookkeeping in a NESTED try that logs but never refunds (the Phase-1-2 lesson, keep it): create session if new (`createSession`), else `appendToSession` — appending both the user message and assistant reply (with `at: deps.now()`), trimming to the cap, incrementing `totalCreditsCharged` by creditsCharged. `recordUsage` also in the nested try.
9. Return ok with sessionId/reply/creditsCharged/model.

**Tests (TDD, 10 — reuse run-skill.test.ts's makeDeps pattern):** charged happy path asserting `operationId` prefix `gpt_msg_` and amount; master exempt; null-planMode included; byok gate 403 both ways; 402 without model call; refund on model throw; 429 CapExceededError with refund; cross-tenant gpt → 404; session-gpt mismatch → 404; post-success bookkeeping throw → still ok, no refund.

**Steps:** TDD RED→GREEN (10/10) → full suite green → commit `feat(promptexpert): GPT chat engine with per-message charge ladder`.

---

### Task 5: GPT CRUD API + client subscribe helpers

**Files:** Create `src/app/api/sub-accounts/[id]/promptexpert/gpts/route.ts`; modify `src/lib/firestore/promptexpert.ts` (append subscribes only).

Route (read `run/route.ts` first for idioms; Admin SDK; `requireSubAccountAdmin`):
- `POST` body `{ name, description?, basePromptId?, pinnedGemIds?, allowedSkillIds?, creditCostPerMessage? }` → validate: name non-empty ≤120 chars; `creditCostPerMessage = Math.max(0, Math.trunc(Number(v ?? 1) || 0))`; arrays ≤ 20 ids each; **every referenced id exists AND belongs to this subAccountId** (batch `getAll` on pe_prompts/pe_gems/pe_skills; any mismatch → 422 `{error:"cross_tenant_ref", detail}` — this is the design's Postgres-trigger equivalent). Write doc with tenant stamps + timestamps → `201 {id}`.
- `PATCH` body `{ gptId, ...same fields }` → load doc, 404 if missing/cross-tenant; re-validate any provided ref arrays the same way; update with `updatedAt`.
- No DELETE (v1).

Client helpers (mirror existing `subscribeToCollection` generic in the same file):
```ts
export const subscribeToPeGpts = (s: TenantScope, cb: (r: PeGpt[]) => void, onError?: (e: Error) => void) => ...   // collection "pe_gpts"
export const subscribeToPeGptSessions = (s: TenantScope, cb: (r: PeGptSession[]) => void, onError?: (e: Error) => void) => ...
```

**Steps:** implement → `pnpm tsc --noEmit && pnpm lint` clean → commit `feat(promptexpert): server-validated GPT CRUD API + subscriptions`.

---

### Task 6: Chat API route

**Files:** Create `src/app/api/sub-accounts/[id]/promptexpert/gpts/[gptId]/chat/route.ts`. Read `run/route.ts` FIRST — this route is its sibling: same auth, same deps wiring (`resolvePartnerProfileId` wallet lookup, `spendCredits`/`serverApplyCreditDelta` adapters, `resolveAiCallContext`, `callAi` with `maxTokens: PE_MAX_OUTPUT_TOKENS`-equivalent constant `PE_GPT_MAX_OUTPUT_TOKENS = 1024`), plus:
- Body validation: `{ sessionId?: string|null, message: string }` — message non-empty string ≤ 4000 chars → else 400.
- `now: () => Date.now()`, `newMessageId: () => db.collection("ai_runs").doc().id`.
- Session Firestore adapters against `pe_gpt_sessions` (Admin SDK; ring-buffer trim to `PE_GPT_SESSION_MAX_MESSAGES` on append).
- Also log each turn to `ai_runs` (source `"promptexpert_gpt"`, same field mapping as the run route — copy its `mapRunPatch`/status remaps).
- Response mapping identical to the run route (200/400/402/403/404/429/500), 200 = `{ sessionId, reply, creditsCharged, model }`.
- `requireSubAccountMember` (members chat; only admins build).

**Steps:** implement → typecheck/lint → full suite → commit `feat(promptexpert): GPT chat API route`.

---

### Task 7: GPTs builder screen

**Files:** Create `src/app/(dashboard)/sa/[subAccountId]/promptexpert/gpts/page.tsx`. Templates: `skills/page.tsx` (the hardened patterns: save-guard, saving state, native selects, a11y) — but writes go through `fetch` to the T5 API, NOT client Firestore.

Per card: GPT name, description, `<Badge variant="outline">{creditCostPerMessage} credit/message</Badge>`, pinned-gem count, **"Chat" button** (`render={<Link href={saPath(`/promptexpert/gpts/${gpt.id}`)}/>}`) visible to all members, Edit (admin). Builder Sheet fields: name (aria-required), description, base prompt (native select over subscribed pe_prompts, "None" option), pinned gems (checkbox list over subscribed pe_gems, cap 20), allowed skills (checkbox list, cap 20 — labeled "Skills (reserved for tool use — coming soon)"), creditCostPerMessage (number input, same parser + hint pattern as skills). Save → POST/PATCH the API; handle 422 cross_tenant_ref with a toast; generation-guard any async state writes.

**Steps:** implement → typecheck/lint → commit `feat(promptexpert): GPT builder screen`.

---

### Task 8: GPT chat screen

**Files:** Create `src/app/(dashboard)/sa/[subAccountId]/promptexpert/gpts/[gptId]/page.tsx`. Structural reference for the thread UI: `src/components/ai-agents/web-chat-session-thread.tsx` (token-styled bubbles) — do NOT reuse the embed `chat-window.tsx` (inline styles by design).

Client page: load the GPT (from `subscribeToPeGpts`, find by id — 404 empty-state if absent), keep `sessionId` in state (null until first reply), message list state (optimistic user bubble), composer (textarea + send on Enter, shift+Enter newline), busy state disabling send, per-message cost chip in the header ("{n} credit/message · runs on your workspace credits"), error handling identical to the skills run panel (402 with `saPath("/credits")` top-up link, 403 upsell, 429, network) — copy those verbatim strings, generation-guard the response writes, `aria-live="polite"` on the thread container.

**Steps:** implement → typecheck/lint → full suite → commit `feat(promptexpert): GPT chat screen`.

---

### Task 9: Public /promptexpert marketing page

**Files:** Create `src/app/promptexpert/page.tsx`; modify `src/middleware.ts` (add `"/promptexpert"` to `PUBLIC_PATHS`, alphabetical placement with the other UI paths).

Server component with its own `export const metadata` (title `PromptExpert — your best AI prompts, one click away | UGotLeads`, description from the design). Content: adapt the betterpromptcopy.com narrative (hero with the prompt-card visual rebuilt with app design tokens; the five-pieces section; how-it-works; CTA) but UGL-branded: uses the root layout fonts (`Instrument_Serif` display + Geist), landing-custom conventions (read `src/components/landing-custom/hero.tsx` for section/container idioms), CTAs → `/signup` and `/login`. Keep it self-contained in the one file (local components) — do not modify landing-custom shared components. Must render for logged-OUT users (verify middleware allows it).

**Steps:** implement → `pnpm build` (public routes are picky) → manual curl `http://localhost:3000/promptexpert` returns 200 logged-out (controller verifies live) → commit `feat(promptexpert): public marketing page`.

---

### Task 10: Top-up checkout route

**Files:** Create `src/app/api/credits/topup/checkout/route.ts`. Read `src/app/api/marketplace/checkout/route.ts` FIRST (Stripe client init, origin resolution, auth idioms) — mirror them.

`POST` body `{ packId: "starter"|"growth"|"scale", subAccountId: string }`:
1. `requireSubAccountMember(request, subAccountId)` (any member can top up their workspace).
2. Look up the pack in `CREDIT_PACKS` → 400 unknown packId.
3. `stripe.checkout.sessions.create({ mode: "payment", line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: pack.priceUsdCents, product_data: { name: \`UGotLeads Credits — ${pack.name} (${pack.credits} credits)\` } } }], success_url: \`${origin}/sa/${subAccountId}/credits?topup=success\`, cancel_url: \`${origin}/sa/${subAccountId}/credits?topup=cancelled\`, metadata: { kind: "credit_topup", packId: pack.id, credits: String(pack.credits), agencyId: auth.agencyId, subAccountId, purchaserUid: auth.uid } })` → `200 { url }`.
4. No feature-flag gate (unlike marketplace) — but if `process.env.STRIPE_SECRET_KEY` is absent, 503 with a clear message (mirror `gitpageIsConfigured` pattern).

**Steps:** implement → typecheck/lint → commit `feat(credits): top-up checkout session route`.

---

### Task 11: Top-up fulfillment (TDD) + webhook branch

**Files:** Create `src/lib/credits/topup.ts` + `src/lib/credits/__tests__/topup.test.ts`; modify `src/lib/stripe/webhooks.ts` (new `kind === "credit_topup"` branch in `handleCheckoutCompleted`, alongside the marketplace branch).

`topup.ts` (DI'd for tests; the route/webhook wires Admin SDK):

```ts
import "server-only" — NO: keep pure/DI'd like the engines (webhooks.ts is already server-only).

export interface FulfillTopupDeps {
  findTxnByReference(referenceId: string): Promise<boolean>;   // credit_transactions where referenceId == sessionId, limit 1
  ensureWallet(input: { walletId: string; agencyId: string; subAccountId: string }): Promise<void>;
  // ensureWallet: create-if-missing with subAccountId STAMPED; if wallet exists with subAccountId null, set it (merge). Never overwrite a DIFFERENT existing subAccountId — leave it and log.
  applyCredit(input: { agencyId: string; partnerProfileId: string; delta: number; description: string; referenceId: string }): Promise<{ ok: true } | { error: true; message: string }>;
}
export interface TopupEvent { sessionId: string; agencyId: string; subAccountId: string; purchaserUid: string; credits: number; packId: string; }
export type FulfillResult = { fulfilled: true } | { duplicate: true } | { error: true; message: string };
export async function fulfillTopup(deps: FulfillTopupDeps, ev: TopupEvent): Promise<FulfillResult>;
```

Flow: validate `credits` int > 0 and ≤ 100000 (paranoia vs forged metadata — also re-derive from `CREDIT_PACKS` by packId and REJECT if mismatch: `error "pack_mismatch"`) → `findTxnByReference(sessionId)` true ⇒ `{duplicate:true}` → `ensureWallet({walletId: purchaserUid, ...})` → `applyCredit({partnerProfileId: purchaserUid, delta: +credits, description: \`Credit top-up: ${packId} pack\`, referenceId: sessionId, type handled inside as "purchase"})` → fulfilled.

**Tests (6):** happy path (asserts ensureWallet called with subAccountId, applyCredit delta exact); duplicate sessionId no-ops (no ensureWallet/applyCredit calls); pack/credits mismatch rejected; credits ≤ 0 rejected; applyCredit error propagates; ensureWallet failure propagates as error (wrap in try).

Webhook branch (in `webhooks.ts`, mirror the marketplace branch's structure): parse metadata, build real deps — `findTxnByReference` = Admin query on `credit_transactions` `where("referenceId","==",sessionId).limit(1)`; `ensureWallet` = transaction: get `credit_wallets/{uid}`; missing → set full wallet doc (balance 0, lifetime zeros, `subAccountId` stamped, timestamps); exists with `subAccountId == null` → merge-set subAccountId; exists with other subAccountId → log warn, no write; `applyCredit` = `serverApplyCreditDelta({ ..., type: "purchase", referenceId, referenceType: "stripe_event" })`. Log fulfillment result with sessionId.

**Steps:** TDD (6/6) → typecheck → full suite → commit `feat(credits): idempotent top-up fulfillment with subAccountId-stamped wallets`.

---

### Task 12: Buy-credits panel on the credits page

**Files:** Modify `src/app/(dashboard)/sa/[subAccountId]/credits/page.tsx` (read fully first; additive changes only).

- New "Buy credits" section above the transaction history: three pack cards from `CREDIT_PACKS` (name, credits, `$` price formatted from cents, per-run hint "≈ N skill runs at 5 credits"), each with a Buy button → POST `/api/credits/topup/checkout` `{packId, subAccountId}` → `window.location.assign(url)`; busy state per button; error toast on failure.
- On mount, read `?topup=success|cancelled` from `useSearchParams()` → sonner toast ("Payment received — credits land within a minute." / "Checkout cancelled.") and strip the param via `router.replace`.
- **Do not** change the partner-profile wallet resolution logic; if the page shows "No partner profile found", the Buy panel still renders (purchase creates the wallet keyed by uid).

**Steps:** implement → typecheck/lint → commit `feat(credits): buy-credits panel wired to top-up checkout`.

---

### Task 13: featurePromptExpert fulfillment hook

**Files:** Modify `src/lib/fulfillment/grant-entitlement.ts` (read fully first).

After the entitlement write succeeds, add:

```ts
// PromptExpert BYOK add-on: purchasing this product unlocks the run/chat routes
// for byok-plan sub-accounts (subAccounts.featurePromptExpert, read === true).
const PROMPTEXPERT_PRODUCT_ID = process.env.PROMPTEXPERT_PRODUCT_ID;
if (PROMPTEXPERT_PRODUCT_ID && input.productId === PROMPTEXPERT_PRODUCT_ID && input.subAccountId) {
  await db.doc(`subAccounts/${input.subAccountId}`).set({ featurePromptExpert: true }, { merge: true });
}
```

(Adapt names to the file's actual parameter/db idioms.) Add `PROMPTEXPERT_PRODUCT_ID=` to `.env.example` with a comment ("marketplace product id that unlocks PromptExpert for BYOK subs; unset = no product mapped yet"). Creating the actual marketplace product listing is Star's admin action later — not code.

**Steps:** implement → typecheck → full suite → `pnpm build` → commit `feat(promptexpert): unlock featurePromptExpert on add-on purchase`.

---

## Definition of Done

- All 13 tasks committed on `feature/promptexpert-phase3`; tsc/lint/vitest/build clean (expect ~190+ tests).
- Manual gates at the end (controller + Star): rules deploy (union check vs unmerged branches), live chat test with a GPT (charge visible in ledger), top-up E2E in **Stripe test mode** if test keys available — else the checkout route + webhook branch are verified by unit tests and a Stripe CLI `trigger checkout.session.completed` is documented as the follow-up.
- NOT in scope: GPT tool-use (allowedSkillIds execution), public GPTs, Chrome extension, agency-level credit packs, `costMicrocents`.
