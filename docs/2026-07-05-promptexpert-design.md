# PromptExpert — In-App Module Design (Path A)
> **Decision (2026-07-05):** PromptExpert is built INSIDE `ugotleads-live` as a
> feature module — not as a separate Supabase app. One Firestore, one credit
> ledger (`credit_wallets` / `credit_transactions`), zero sync surface. The
> earlier Supabase schema + credit-sync bridge designs are superseded; their
> idempotency/ledger semantics already exist here in `src/lib/credits/server.ts`.

---

## 1. What PromptExpert is

A credit-metered AI workspace inside the UGotLeads dashboard, scoped per
sub-account:

1. **Prompts** — templates with `[Variable]` slot placeholders.
2. **Gems** — reusable context blocks (brand bio, persona, technical doc,
   custom) injected via `@`-mention.
3. **Skills** — runnable AI pipelines with a `creditCost`; execution deducts
   credits atomically.
4. **GPTs** — saved assistants = base prompt + pinned gems + allowed skills.
5. **Growth Agents** — scheduled background runs (QStash) for content/social/
   growth tasks.

**Tenancy mapping** (original spec → this codebase):
`workspace` → **subAccount**. `workspace_members` → existing
`subAccountMembers` (+ agency-owner shortcut). `credit_balance` → existing
`credit_wallets` (per partnerProfile funding the sub-account). Nothing new to
invent — we inherit the whole tenancy + billing layer.

**Tenancy reality check (corrected 2026-07-05 — load-bearing):** This is a
MULTI-agency platform. Self-serve signup mints a NEW agency per buyer
(`api/auth/signup`, `selfServeAgencyOwner` path) — so `agencyRole === "owner"`
and the `role: "admin"` claim describe ~every paying customer, NOT the platform
master. Customers own their own agencies and create sub-accounts for their own
clients. **Never key a billing exemption or privileged path to agencyRole/role
claims.** The platform master (Star) is identified only by deployment config:

- **`MASTER_AGENCY_ID` env var** (Vercel + .env.local) = the master agency's
  doc id. Sub-accounts under it run PromptExpert with `creditsCharged: 0`
  (runs still logged in `ai_runs` for cost visibility — the OpenRouter spend
  is real even when credits aren't).
- Works for white-label deployments too: each deployment's operator sets
  their own master id. Unset = nobody exempt (safe default).

**Access & monetization (decided 2026-07-05):**
- **Credit-mode sub-accounts:** PromptExpert is INCLUDED. Every skill run
  consumes credits → drives credit purchases. No gate.
- **BYOK sub-accounts:** PromptExpert is an UPSELL, not automatic. Their runs
  use their own key (zero credit revenue), so access is a paid add-on granted
  through the existing marketplace entitlement system
  (`marketplace/access` precedent). Gate: server routes and UI check
  entitlement when `planMode === "byok"`; locked state shows the marketplace
  upsell card.
- **Subscription-mode:** included (already paying a flat fee; token cap is the
  meter).

**Brand & domain (decided 2026-07-05; structure finalized + DEPLOYED 2026-07-11):**
- **ugotleads.io = primary home.** The PE app lives in this repo; add a public
  `/promptexpert` marketing/upsell route (plain Next.js page) as part of Phase
  2b — this is where platform members discover and buy PE.
- **betterpromptcopy.com = standalone sales page (LIVE).** Sells PE as its own
  technology to cold traffic. Hosted on the legacy GitPage GitHub site
  (pageId 687ca27fdb529f4dc54610a9, repo this-is-a-test-2025-07-20-0dmb6),
  custom domain bound via CNAME file, DNS on Namecheap → GitHub Pages, HTTPS
  active. Premium dark/teal editorial page (Fraunces/Sora), CTA → ugotleads.io.
- **betterpromptcopy.com/playbook = Retirement Income Playbook funnel** (the
  repo's previous root page — a LIVE lead-capture funnel posting to
  app.ugotleads.io forms API). Preserved at this path; any old links to the
  github.io URL now redirect to the domain. If Playbook ads/emails exist,
  update them to /playbook.
- GitPage note: new GitPage sites are GitLab-only now (GitHub = legacy). The
  agency generate-site API requires a GitLab PAT (personal token, not group).
- Optionally map `app.betterpromptcopy.com` to Vercel later — not a launch
  dependency.

---

## 2. Module layout (follows the marketplace/comms template)

```
src/types/promptexpert.ts                     # all PE types, re-export in types/index.ts
src/lib/promptexpert/
  run-skill.ts                                # server-only execution engine
  resolve-mentions.ts                         # expand @gem mentions + [Variable] fills
src/lib/firestore/promptexpert.ts             # client CRUD (subscribeToX/createX/... TenantScope)
src/app/(dashboard)/sa/[subAccountId]/promptexpert/
  page.tsx                                    # overview / library
  prompts/  gems/  skills/  gpts/  agents/    # feature screens
src/app/api/sub-accounts/[id]/promptexpert/
  run/route.ts                                # POST — execute a skill (credit-metered)
  gpts/route.ts                               # POST/PATCH — server-validated GPT writes
src/app/api/cron/pe-agents/route.ts           # QStash-triggered agent runner
```

Sidebar: one entry appended to `SUB_ACCOUNT_NAV` in
`src/components/dashboard/sidebar.tsx` (`href: "/promptexpert"`, lucide icon,
`matchPrefix: true`).

**URL:** `/sa/{subAccountId}/promptexpert` via `saPath()`. The
`promptexpert.ugotleads.io` subdomain has no middleware precedent in this app —
deferred to a later polish phase as a host-rewrite; not a launch blocker.

---

## 3. Firestore collections & rules

Five new collections, every doc carrying `agencyId` + `subAccountId` (the house
pattern). Names prefixed `pe_` to avoid collisions:

| Collection | Client read | Client write | Notes |
|---|---|---|---|
| `pe_prompts` | `canAccessSub` | `canAdminSub` create/update, `tenantFieldsLockedOnUpdate()` | copy `campaigns` block |
| `pe_gems` | `canAccessSub` | `canAdminSub` | `dataContent` capped 50k chars (validated in rules + UI counter) |
| `pe_skills` | `canAccessSub` | `canAdminSub`; `creditCost` int ≥ 0 | |
| `pe_gpts` | `canAccessSub` | **`allow write: if false`** | writes go through the API route so pinned gem/skill ids are validated same-tenant (rules can't affordably check ref arrays) |
| `pe_growth_agents` | `canAccessSub` | `canAdminSub` for config fields; `status`/`lastRun` server-only | |

Run history reuses the existing **`ai_runs`** collection (client read-only,
Admin-SDK writes only — precedent already in rules). No new run-log collection.

Delete policy follows house style (`allow delete: if false` where the template
does; soft-disable instead).

---

## 4. Skill execution — the credit-metered run path (the core of the module)

`POST /api/sub-accounts/[id]/promptexpert/run` — first production consumer of
`spendCredits()`:

```
1. requireSubAccountMember(request, id)         # instanceof NextResponse early-return
1b. ENTITLEMENT GATE — if subAccount.planMode === "byok" and the sub-account
    has no PromptExpert marketplace entitlement → 403 { upsell: true }
2. Load pe_skill + resolve mentions             # gems expanded, [Variables] filled
3. aiCtx = resolveAiCallContext(id)             # hosted vs BYOK key, monthly token cap
     CapExceededError → 429
4. runId = new ai_runs doc id (Admin SDK, status "running")
5. CHARGE — decision ladder:
     a. subAccount.agencyId === process.env.MASTER_AGENCY_ID
          → skip charge, creditsCharged: 0 (platform master dogfooding;
            NEVER key this to agencyRole/role claims — every customer is an
            "owner" of their own agency)
     b. planMode === "credit"
          → spendCredits({ amount: skill.creditCost, operationId: `ai_run_${runId}`, ... })
              insufficient_balance → 402 { currentBalance, required }  (UI shows top-up)
              skipped (duplicate)  → return the existing run           (idempotent retry)
     c. byok / subscription plans skip the charge (token cap is their meter;
        byok additionally requires the marketplace entitlement per §1b).
6. callAi({ apiKey: aiCtx.apiKey, model, messages })
7. await aiCtx.recordUsage(result.totalTokens)
8. Update ai_runs doc: output, tokens, creditsCharged, creditTransactionId, status "succeeded"
9. ON FAILURE after a charge: serverApplyCreditDelta({ delta: +creditCost, type: "refund",
     referenceId: `ai_run_${runId}` }) + ai_runs status "failed"

**Amendment (2026-07-11, Star):** `planMode: null` (legacy subs) = INCLUDED —
uncharged, token-cap-metered, same as "subscription". Note: billing keys off
`planMode`; the AI key source keys off `aiProvider.mode` — these are independent
fields by design; the token cap is the abuse ceiling for all uncharged modes.
```

Design points:
- **Idempotency** rides on `operationId` = the `ai_runs` doc id — the exact
  pattern `spendCredits()`'s docstring prescribes.
- **Charge-then-run with refund-on-failure** (UGL already has the `"refund"`
  txn type) — never run-then-charge, which can leak free runs.
- **`planMode` respected**: credit-mode sub-accounts pay credits; BYOK users
  bring their own key and are metered by the existing token cap only. This
  matches how every other AI feature in the app treats BYOK.

## 5. GPTs & mention resolution

- GPT = `{ name, avatarUrl, basePromptId, pinnedGemIds[], allowedSkillIds[] }`.
  The API route validates every referenced id belongs to the same
  `subAccountId` before writing (replaces the Postgres trigger from the old
  design). `isPublic` is **dropped for v1** — public sharing across tenants is
  a separate feature with real data-governance questions; YAGNI now.
- `resolve-mentions.ts` is a pure function: `(content, gems[], variables{}) →
  finalPrompt`. Unit-testable with vitest (config already present).

## 6. Growth Agents (phase 4)

- Config docs in `pe_growth_agents` (type, channels, `scheduleInterval`
  Daily/Weekly, `configuration`).
- Runner: `api/cron/pe-agents` — added to middleware `PUBLIC_PATHS`, body
  verified via `verifyQStashSignature` (house cron pattern). One QStash
  schedule (e.g. hourly) scans due agents (lookback slightly > interval),
  executes each as a skill-run through the same engine in §4 (same charging,
  same `ai_runs` logging), stamps `lastRun`.
- Social credentials: **not** in `configuration`. Reuse the app's existing
  encrypted-secret pattern (`src/lib/crypto/byok.ts` AES-256-GCM, server-only
  collection like `byok_keys`). Channel OAuth flows are out of scope for v1 —
  agents launch with content-generation targets (write to CRM/drafts) before
  external posting.

## 7. Chrome extension (phase 5 — separate deliverable)

MV3, separate repo/folder. Auth: Firebase ID token; calls the same
`/api/sub-accounts/[id]/promptexpert/*` routes (session middleware already
injects auth from the token; may need a small bearer-token path in middleware
`PUBLIC_PATH_PATTERNS` + in-route verification). Ships zero secrets. Not a
blocker for the web module.

## 8. UI

- shadcn `base-nova` + existing CSS-variable tokens; dark mode via
  `next-themes`. **No new design system in-app** — PromptExpert adopts the app
  shell for consistency. The premium dark/teal "promptineer-class" aesthetic
  lives on the **betterpromptcopy.com sales page** (GitPage), where it sells.
  Best of both: house UI inside, distinctive brand outside. (Resolved
  2026-07-05.)
- CRUD screens copy `forms/page.tsx`: `useSubAccount()`, real-time
  `subscribeToX`, create/edit in a `<Sheet>`, sonner toasts, `EmptyState` +
  `ListSkeleton`.
- Prompt editor highlights `[Variable]` tokens; gem picker is an `@`-mention
  combobox; run panel shows cost ("This run: 5 credits · balance 495") before
  execute; 402 responses surface the existing credits top-up page via
  `saPath("/credits")`.

## 9. Build phases

| Phase | Scope | Depends on |
|---|---|---|
| 1 | Types + rules + client CRUD + Prompts & Gems screens + sidebar | — |
| 2 | Run engine (`run-skill.ts`, run route, credit charge/refund, BYOK entitlement gate) + Skills screen | 1 |
| 2b | **betterpromptcopy.com sales page on GitPage** (dark/teal aesthetic, buy domain, map it) — parallel to any phase | — |
| 3 | GPTs (server-validated writes, builder UI, run-with-GPT) | 2 |
| 4 | Growth Agents + QStash runner | 2 |
| 5 | Chrome extension MV3 | 2 |
| 6 | Polish: `app.betterpromptcopy.com` on Vercel, public GPTs (re-evaluate), channel OAuth | 3–5 |

Each phase is independently shippable; 1+2 alone is a usable, billable product.

## 10. Testing

- Unit (vitest, present): `resolve-mentions`, charge/refund state machine in
  `run-skill` (mock Admin SDK + `callAi` at the boundary).
- Rules: new `pe_*` blocks mirror `campaigns`/`ai_runs` precedents; verify a
  cross-tenant read/write is denied (firestore emulator if configured, else
  manual matrix).
- E2E happy path: create prompt → create gem → run skill → balance decremented
  → `ai_runs` row → duplicate operationId returns same run.

## Superseded documents
- `promptexpert_schema_fixed.sql`, `promptexpert_credit_sync.sql`,
  `promptexpert_credit_sync_design.md`, `promptexpert_lovable_prompt.md`
  (scratchpad, 2026-07) — Supabase/Path-B artifacts. Keep for reference; do not
  implement.
