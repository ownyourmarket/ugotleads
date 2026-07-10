# Suit ↔ UGotLeads Agent Bridge — Design Spec

- **Status:** Approved design (Star, 2026-07-09)
- **Author:** Claude (brainstormed with Star Riley)
- **Scope:** Two codebases — `ugotleads-live` (this repo) and the MyUSA Suit (`~/.claude`)
- **Related:** `docs/PER_TENANT_EMAIL_SPEC.md`, `docs/TIER3_PHASE2_SPEC.md`

## 1. Problem

The MyUSA OS has a brain and hands that aren't connected. The suit (Claude Code +
skills + agents + orchestrator) can research, plan, and write personalized outreach.
UGotLeads (this app) is the system of record and the sending engine. But no bridge
exists: every authed API route trusts an `x-user-uid` header that only the edge
middleware can set after validating a Firebase session cookie, so agents have no way
in — Star pastes cold emails into the app by hand.

Two concrete gaps drive this spec:

1. **No service auth.** The only machine-auth in the app is QStash HMAC signature
   verification on callback routes. There is no API key, bearer token, or service
   account path.
2. **No outbound sequences.** The automation engine's only trigger type is
   `form_submit` (inbound). Imported cold contacts cannot be enrolled in a drip,
   and nothing stops a sequence when a prospect replies (replies aren't ingested
   at all — they land in a human inbox and the CRM never sees them).

## 2. Decisions made (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Where the sequence engine lives | **Native in UGotLeads** | Runs 24/7 on Vercel + QStash with Star's machine off; becomes a sellable product feature for every operator/tenant. |
| Bridge scope (v1) | **Full CRM operation** | Contacts, sends, sequences, replies, deals/pipeline, templates, reporting reads. |
| Send approval model | **Approve batches, not emails** | Agent drafts campaign (copy + audience + sequence); Star approves once; engine executes autonomously with stop-on-reply as the safety net. Matches governance ASK tier without recreating the manual bottleneck. |
| Architecture | **Agent API layer + MCP server from day one** | Service-keyed `/api/agent/v1/*` routes keep opt-out/logging/scheduling enforced server-side; a local MCP server is the suit's tool layer (WAT Layer 3), not loose scripts. Direct Firestore Admin access was rejected: it bypasses every safety rail. |

## 3. Architecture overview

```
┌─────────────────────────── MyUSA Suit (~/.claude) ───────────────────────────┐
│  Layer 1  workflows/outbound-campaign.md, reply-triage.md, pipeline-review.md │
│  Layer 2  /outreach orchestrator skill  (batch-approval gate lives here)      │
│  Layer 3  ugotleads-bridge MCP server (local stdio, TypeScript)               │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │ HTTPS  Authorization: Bearer ugl_<key>
┌───────────────────────────────────▼──────────────────────────────────────────┐
│  UGotLeads (app.ugotleads.io, this repo)                                      │
│  /api/agent/v1/*  ← requireServiceAuth() (new)                               │
│  Existing engine: automations executor + QStash scheduling + Resend sending  │
│  New: manual/tag_added triggers, outbound_sequence recipe, stop-on-reply,    │
│       /api/webhooks/resend-inbound reply ingestion                           │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Key insight from recon:** the `lead_nurture` recipe + `executor.ts` + QStash already
implement a multi-step delayed drip with opt-out checks, send windows, merge tags,
unsubscribe links, and activity logging. The outbound-sequence feature is mostly an
**enrollment problem** (`fireTriggers()` in `src/lib/automations/triggers.ts` is the
ready-made hook) plus a **reply-ingestion problem** (greenfield).

### Campaign data flow (the Box 1 motion)

1. Suit agent researches prospects and drafts the campaign: audience (tag), Email 1
   personalizations, sequence steps (e.g. Email 2 day 4, Email 3 day 9).
2. **Star approves the batch once, in chat.** The enroll tool refuses to execute
   without an explicit confirmation parameter echoing the campaign summary.
3. Bridge tools execute: import + tag contacts → create/update templates → create
   `outbound_sequence` automation → enroll the tag.
4. The native engine runs the drip 24/7: send-window aware, opt-out checked,
   activity logged — all existing machinery.
5. A reply hits the inbound webhook → sequence stops for that contact, `email_reply`
   activity logged → suit's daily digest lists new replies → agent drafts responses
   → queued for Star's OK (v1 keeps reply-sending human-gated).

## 4. UGotLeads-side components (this repo)

### 4.1 Service auth

- New guard `src/lib/auth/require-service-auth.ts`. Reads
  `Authorization: Bearer ugl_<key>`; hashes (SHA-256) and looks up the key in a new
  top-level `agencyServiceKeys` collection:

  ```ts
  interface ServiceKeyDoc {
    agencyId: string;
    label: string;                 // "suit-bridge-main"
    keyHash: string;               // sha256 of full key; plaintext never stored
    keyPrefix: string;             // first 8 chars, for display/audit
    allowedSubAccounts: string[];  // v1: [MAIN_SUB_ACCOUNT_ID] only
    scopes: ServiceScope[];        // e.g. "contacts:write", "sequences:enroll",
                                   // "sends:execute", "deals:write", "reports:read"
    status: "active" | "revoked";
    createdAt; lastUsedAt;
  }
  ```

- The guard returns the same access shape as `require-tenancy.ts` so agent-route
  code reads like existing route code. It enforces: key active → sub-account in
  `allowedSubAccounts` → required scope present. Updates `lastUsedAt`.
- Agent routes are added to `PUBLIC_PATHS` in `src/middleware.ts` (middleware
  bypass) and guarded internally — the exact pattern the QStash callback routes use.
- Key management: agency-owner-only UI/route to create + revoke keys (plaintext
  shown once at creation). Rotation = create new, revoke old.

### 4.2 Agent API routes (`/api/agent/v1/*`)

All Admin-SDK-backed (today's CRM writes are client-side Firestore SDK governed by
`firestore.rules`, which an HTTP service can't use). Every route takes/derives
`subAccountId` and validates it against the key's allowlist. Consistent envelope
`{ data, error }`; typed error codes; ISO 8601 timestamps.

| Route | Methods | Scope | Notes |
|---|---|---|---|
| `contacts` | POST (create), GET (search/list) | contacts:write / read | search by email/phone/tag/stage |
| `contacts/[id]` | GET, PATCH | contacts:read / write | field updates, tag add/remove |
| `contacts/import` | POST | contacts:write | batch create, same validation as CSV import (email OR phone) |
| `deals` + `deals/[id]` | POST, PATCH | deals:write | create, move pipeline stage |
| `templates` + `templates/[id]` | GET, POST, PATCH | templates:write | email templates; server runs `validateEmailBody` (unsubscribe link required) |
| `sequences` | GET, POST | sequences:write | create `outbound_sequence` automation |
| `sequences/[id]/enroll` | POST | sequences:enroll | body: `{contactIds[] \| tag, confirm: {expectedCount, summary}}` — refuses if `confirm` absent or count mismatched (batch-approval enforcement) |
| `sequences/[id]/unenroll` | POST | sequences:enroll | stop executions (`stoppedReason: "manual"`) |
| `sequences/[id]/status` | GET | reports:read | per-contact execution states |
| `messages/email` / `messages/sms` | POST | sends:execute | one-off sends; reuse `sendEmail()`/`sendSms()` + activity logging |
| `replies` | GET, PATCH | replies:read / write | list new replies, mark handled |
| `reports/summary` | GET | reports:read | pipeline counts, sequence stats, recent activity |

- **Audit:** every agent write stamps `createdBy: "agent:<keyPrefix>"` in contact
  activities / doc metadata. What the AI did is always visible in the timeline.
- **Idempotency:** mutating routes accept an `Idempotency-Key` header; keys stored
  with a TTL so tool retries can't double-create or double-enroll.
- **Server-side caps (v1 defaults, stored on the key doc):** max 200 contacts per
  enroll call, max 500 new enrollments/day, max 100 one-off sends/day. 429 with
  `Retry-After` beyond caps.

### 4.3 Sequence engine extension

- `AutomationTriggerType` gains `"manual"` and `"tag_added"` (today: `form_submit`
  only). `AutomationTrigger` gains optional `tag` field.
- New `RecipeType: "outbound_sequence"` with config shaped like `LeadNurtureConfig`
  (ordered steps, `delaySeconds` from enrollment) — reuses `planSteps()` machinery.
- `StoppedReason` gains `"replied"`.
- Enrollment: `sequences/[id]/enroll` calls `startExecution()` per contact (the same
  path `fireTriggers()` uses).
- **Enrollment is idempotent:** at most one execution per (automationId, contactId),
  ever — contacts with an existing execution (running, completed, or stopped) are
  skipped and reported in `skipped[]`. This is the anti-double-email guarantee and
  makes every enroll call safely re-runnable.
- **`tag_added` coverage (decided 2026-07-09):** fires live via `fireTriggers()`
  from all **server-side** tag-write paths — `api/contacts/bulk` (how the dashboard
  bulk-tags), `api/contacts/merge`, and every agent-API route that writes tags.
  Client-SDK tag writes (single-contact form, CSV import dialog) do not fire live;
  instead the `enroll {tag}` endpoint doubles as a **catch-up sync** (scan current
  tag members, enroll anyone missing — safe because enrollment is idempotent), and
  the suit's daily pipeline-review workflow calls it. Cloud Functions Firestore
  triggers were considered and rejected for v1: a second deploy pipeline + Blaze
  billing to close a gap the daily sync already closes.
- Existing kill switches unchanged: `automation.enabled`, `automationsPaused`,
  per-channel opt-out, send-window deferral.

### 4.4 Reply ingestion + stop-on-reply

- New `PUBLIC_PATHS` route `src/app/api/webhooks/resend-inbound/route.ts`, mirroring
  the Twilio inbound pattern (`api/webhooks/twilio/inbound`): verify webhook
  signature → match `from` address to a contact in the sub-account → append to the
  contact's `messages`/activities (`type: "email_reply"`, subject + text) → **stop
  all running `outbound_sequence` executions for that contact**
  (`stoppedReason: "replied"`).
- **Resend inbound CONFIRMED (Star, 2026-07-09):** Resend supports receiving email —
  an `email.received` webhook event delivers a structured JSON payload (content,
  HTML, headers, attachments) to an endpoint; routing works on a `.resend.app`
  domain or a custom domain. Phase 2 tasks: set up inbound routing/DNS for
  `hey.ugotleads.io`, verify the webhook signature, and set sequence emails'
  `replyTo` to the ingest address (with `subAccount.replyToEmail` kept in the loop
  via a forward/CC strategy decided in phase 2 planning).

## 5. Suit-side components (`~/.claude`)

- **Layer 3 — `ugotleads-bridge` MCP server** (TypeScript, stdio, lives in the suit
  as `tools/ugotleads-bridge/`): one deterministic tool per agent-API endpoint,
  typed inputs/outputs, service key + base URL from `.env`. Registered via
  `claude mcp add` so every session and subagent gets the tools. No business logic
  in tools — they are thin, testable API callers (WAT discipline).
- **Layer 1 — workflows** (`workflows/`): `outbound-campaign.md` (research → draft →
  approval → import → enroll → monitor), `reply-triage.md` (digest → draft →
  approve → send), `pipeline-review.md` (stage hygiene, follow-up nudges).
- **Layer 2 — `/outreach` orchestrator skill**: runs the campaign motion per the
  workflow. **Hard gate:** it never calls `enroll`, `messages/*`, or reply-send
  tools without Star's explicit in-chat approval of the specific batch (audience
  count + copy + schedule shown first). This encodes the governance ASK tier.

## 6. Security model

- Key scoped to the **Main (MyUSA Local) sub-account only** in v1 — CleanMyTap and
  future client sub-accounts are unreachable even with a leaked key.
- Scopes let future keys be read-only or enroll-only.
- Plaintext key lives only in the suit's `.env` (never committed, per security
  rules) and in Star's password manager.
- Server-side caps (4.2) bound the blast radius of a runaway agent to a bad day,
  not a burned domain.
- All existing recipient protections (opt-out flags, unsubscribe links, send
  windows, 5/sec broadcast rate) apply unchanged to agent-initiated activity.
- Reply/inbound webhook validates provider signature; unmatched senders are logged
  and dropped.

## 7. Error handling

- Typed error envelope: `{ error: { code, message, details? } }` with codes like
  `INVALID_KEY`, `SCOPE_MISSING`, `SUB_ACCOUNT_FORBIDDEN`, `CAP_EXCEEDED`,
  `CONFIRM_MISMATCH`, `VALIDATION_FAILED`.
- MCP tools retry 429/5xx with exponential backoff (max 3); 4xx surface immediately
  to the orchestrator with the server message. Failures are reported, never silent.
- Enrollment is per-contact transactional: a batch reports
  `{enrolled[], skipped[{contactId, reason}]}` — partial success is visible, not
  hidden.
- QStash-side idempotency and step-skip logic in `executor.ts` are unchanged.

## 8. Testing & rollout

- **Unit:** `requireServiceAuth` (key states, scopes, sub-account allowlist), each
  agent route (validation, caps, idempotency, confirm-gate), trigger/recipe
  additions, reply-matcher.
- **Integration:** against a dedicated test sub-account on a Vercel preview deploy —
  full campaign lifecycle (import → enroll → step send → reply → stop) with Resend
  test mode.
- **Dogfood (phase 4):** Box 1's 39 auto-vertical prospects are the first live
  campaign — Email 2/3 follow-ups on the `box1` tag, run entirely through the
  bridge. Every friction found feeds the spec for operator-facing release.

## 9. Phases (each gets its own implementation plan)

| Phase | Deliverable | Repo |
|---|---|---|
| 1 | Service auth + core agent API (contacts, templates, one-off sends, deals, reports) | ugotleads-live |
| 2 | Outbound sequence engine (triggers, recipe, enroll routes) + reply ingestion + stop-on-reply | ugotleads-live |
| 3 | `ugotleads-bridge` MCP server + workflows + `/outreach` orchestrator skill | suit (`~/.claude`) |
| 4 | Dogfood: Box 1 campaign end-to-end; fix frictions; write operator SOP | both |

**Interim (unblocked today, outside this spec):** Box 1 Email 2/3 follow-ups can run
now as native broadcasts to the `box1` tag (QStash + EMAIL_FROM are live). The bridge
does not block the current week's revenue motion.

## 10. Non-goals (v1)

- No approval UI inside UGotLeads (chat approval is the v1 gate; a `campaigns`
  review screen is a later operator feature).
- No per-tenant sending domains (that's `PER_TENANT_EMAIL_SPEC.md` Model B — bridge
  sends ride the current shared `hey.ugotleads.io` sender and adopt Model B when it
  lands).
- No autonomous reply-sending (drafts queue for Star in v1).
- No SMS sequences (email first; SMS blocked on A2P 10DLC approval anyway).
- No operator-facing key management docs until phase 4 dogfood is done.

## 11. Open questions (tracked into phase planning)

1. Reply-to strategy when the ingest address is active: forward-to-human vs CC vs
   inbox-check hybrid (phase 2).

*(Resolved 2026-07-09: Resend inbound is supported — see 4.4. `tag_added` coverage
decided — see 4.3.)*
