# Agent API v1 Reference

Reference for the machine-to-machine "agent bridge" API — Phase 1
(contacts/deals/templates/sends/reports) plus Phase 2 (outbound sequences,
replies, the inbound-reply webhook). This is the input contract for the
Phase 3 MCP server — every endpoint below is grounded in the actual route
source under `src/app/api/agent/v1/` (and `src/app/api/webhooks/` for the
one webhook), not the original spec (some scopes and routes were adjusted
during implementation; see Notes). Phase 2 additions are dated in-line
where the observed responses come from the Task 13 live smoke.

## Base URL

```
https://app.ugotleads.io
```

All endpoints below are relative to this base, e.g.
`https://app.ugotleads.io/api/agent/v1/contacts`.

## Authentication

Every request must include a service key as a Bearer token:

```
Authorization: Bearer ugl_<40-hex-chars>
```

Keys are minted per-agency, scoped to specific permissions (`scopes`) and a
specific list of sub-accounts (`allowedSubAccounts`). A key that is missing,
malformed, unknown, or revoked returns `401 INVALID_KEY`. A key that lacks
the scope required by the endpoint returns `403 SCOPE_MISSING`.

404/403 semantics for sub-account access are deliberately different
depending on how the sub-account is determined:

- An explicit `subAccountId` passed in the request body or query string
  (e.g. `POST /contacts`, `GET /contacts`, `POST /contacts/import`) that
  falls outside the key's `allowedSubAccounts` returns
  `403 SUB_ACCOUNT_FORBIDDEN` — the caller named a specific sub-account it
  isn't allowed to touch, so there's nothing to hide.
- An object ID that resolves to a document belonging to a different tenant
  (e.g. `GET/PATCH /contacts/{id}`, `PATCH /deals/{id}`, `GET/PATCH
  /templates/{id}`, the contact lookup inside `POST /messages/email`)
  returns `404 NOT_FOUND` instead of `403` — indistinguishable from the ID
  simply not existing. This prevents using the API to enumerate valid
  object IDs belonging to other agencies/sub-accounts by timing a 403 vs.
  404 response.

## Response envelope

Success:

```json
{ "data": { ... } }
```

Error:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "...", "details": { ... } } }
```

`details` is omitted when there's nothing structured to add.

## Error codes

Source: `src/lib/agent-api/errors.ts`

| Code | Typical status | Meaning |
|---|---|---|
| `INVALID_KEY` | 401 | Missing/malformed `Authorization` header, unknown key, or key `status: "revoked"` |
| `SCOPE_MISSING` | 403 | Key doesn't have the scope this endpoint requires |
| `SUB_ACCOUNT_FORBIDDEN` | 403 | Key isn't allowed on the resolved sub-account |
| `CAP_EXCEEDED` | 429 | Daily cap reached (see Caps below); response includes `Retry-After` header |
| `VALIDATION_FAILED` | 400 / 409 | Bad input, or (on contact create) a duplicate email in the sub-account |
| `NOT_FOUND` | 404 | Resource doesn't exist, or doesn't belong to the caller's sub-account |
| `CONTACT_OPTED_OUT` | 409 | Target contact has `emailOptedOut: true` |
| `CONFIRM_MISMATCH` | 409 | `POST /sequences/{id}/enroll` — `confirm.expectedCount` was missing or didn't equal the resolved audience size (see Sequences below) |
| `SEND_FAILED` | 502 / 503 | Email provider not configured, or the send itself failed |
| `INTERNAL_ERROR` | 500 | Unhandled server-side failure (currently only `reports/summary`'s catch block) |

## Caps

| Cap | Limit | Enforced in |
|---|---|---|
| Sends per key per UTC day | 100 | `POST /messages/email` via `enforceDailyCap` (`src/lib/agent-api/caps.ts`) |
| Enrollments per key per UTC day | 500 | `POST /sequences/{id}/enroll` via `enforceDailyCap(cap: "enrollments")` — counted as a preflight against the *resolved audience size*, not per-call |
| Contacts/tag matches per enroll call | 200 (`MAX_BATCH`) | `POST /sequences/{id}/enroll`, `POST /sequences/{id}/unenroll` |
| Steps per sequence | 10 (`MAX_STEPS`) | `POST /sequences` |
| Rows per import call | 200 | `POST /contacts/import` |
| Search page size | 100 (default 20, `limit` query param clamped to 1-100) | `GET /contacts` |

Cap-exceeded responses are `429 CAP_EXCEEDED` with a `Retry-After` header
(seconds until UTC midnight).

## Idempotency-Key convention

Mutating endpoints that create records (`POST /contacts`, `POST
/contacts/import`, `POST /deals`, `POST /messages/email`) accept an optional
`Idempotency-Key` header. Source: `src/lib/agent-api/idempotency.ts`.

- If the header is present and a response was already stored for
  `{keyId}_{sha256(idempotencyKey)}` within the last 24h, that stored
  response is replayed verbatim with an `x-idempotent-replay: true` header —
  the handler does not run again.
- Only responses with `status < 500` are cached; a 5xx is always retryable.
- If the header is omitted, the request is not deduplicated — every call
  runs the handler.
- Known limitation documented in source: two truly concurrent requests with
  the same *fresh* key can both run the handler (the check-then-set has no
  transaction wrapping it). Acceptable for a single orchestrator caller; not
  safe for a fleet of concurrent callers sharing one key.

Keys are scoped per service key **and** per endpoint — the storage key is
`{keyId}_{sha256(scope + "\n" + idempotencyKey)}`, where `scope` is the
route's own identifier (e.g. `"sequences:enroll"`), so the same
`Idempotency-Key` value reused on two different endpoints resolves to two
different storage keys and will not cross-replay. Still generate a fresh,
unique key per logical action (a UUID per operation is the simplest safe
pattern) — reusing one key as a general "this agent run" identifier across
multiple calls on the *same* endpoint will still replay the first call's
response on the second.

## Endpoints

### `POST /api/agent/v1/contacts`
**Scope:** `contacts:write`

Create a contact. Requires `subAccountId` and either `email` or `phone`.
Rejects invalid email format. Deduplicates on `(subAccountId, email)` via a
transactional query-then-set (see Notes for the concurrency caveat).

Request:
```json
{
  "subAccountId": "DDEParISNUlxoMiimi2X",
  "name": "Bridge Smoke",
  "email": "bridge-smoke@example.com",
  "phone": "",
  "company": "",
  "tags": ["bridge-smoke"],
  "source": "other",
  "pipelineStage": "new"
}
```

Response `201`, observed in smoke test:
```json
{ "data": { "id": "Jx6xqisgz1dfRtep0Lrk" } }
```

Duplicate email → `409 VALIDATION_FAILED` with
`details.existingId` set to the pre-existing contact's id.

### `GET /api/agent/v1/contacts`
**Scope:** `contacts:read`

Query params: `subAccountId` (required), `limit` (1-100, default 20),
`email`, `phone`, `tag` (array-contains), `pipelineStage`.

Response, observed in smoke test (`?subAccountId=...&tag=bridge-smoke`):
```json
{
  "data": [
    {
      "id": "Jx6xqisgz1dfRtep0Lrk",
      "name": "Bridge Smoke",
      "email": "bridge-smoke@example.com",
      "phone": "",
      "company": "",
      "tags": ["bridge-smoke"],
      "pipelineStage": "new",
      "emailOptedOut": false,
      "smsOptedOut": false
    }
  ]
}
```

### `GET /api/agent/v1/contacts/{id}`
**Scope:** `contacts:read`

Returns the full contact record including `subAccountId`. `404 NOT_FOUND`
if the doc doesn't exist, or exists but belongs to a sub-account the key
isn't allowed to touch (see the 404/403 semantics note above).

### `PATCH /api/agent/v1/contacts/{id}`
**Scope:** `contacts:write`

Body (all optional): `name`, `company`, `phone`, `email`, `pipelineStage`
(must be one of the `PIPELINE_STAGES` ids below), `addTags` (string[]),
`removeTags` (string[]). Tags are merged read-modify-write, not
`arrayUnion`. A `pipelineStage` change writes a `pipeline_moved` activity
record on the contact.

Response:
```json
{ "data": { "id": "...", "tags": ["..."], "pipelineStage": "contacted" } }
```

### `POST /api/agent/v1/contacts/import`
**Scope:** `contacts:write`

Body: `subAccountId`, `contacts[]` (1-200 rows, same shape as the create
body). Per-row behavior mirrors the CSV importer: a row with neither email
nor phone is skipped (`missing_email_and_phone`); a malformed email with no
phone is skipped (`invalid_email`); a malformed email *with* a phone has the
email dropped and the row still imports; duplicate emails (within the batch
or already in Firestore) are skipped (`duplicate_email`).

Response `201`:
```json
{
  "data": {
    "created": 3,
    "skipped": [
      { "index": 4, "reason": "duplicate_email" }
    ]
  }
}
```

### `POST /api/agent/v1/deals`
**Scope:** `deals:write`

Body: `subAccountId`, `contactId`, `title` (required); `value` (number,
default 0), `currency` (default `"USD"`), `stageId` (default `"new"`, one
of the `PIPELINE_STAGES` ids), `priority` (default `"medium"`, one of
`high|medium|low`). The referenced contact must exist and belong to
`subAccountId`, or `404 NOT_FOUND`.

Response `201`:
```json
{ "data": { "id": "..." } }
```

### `PATCH /api/agent/v1/deals/{id}`
**Scope:** `deals:write`

Body (all optional): `title`, `value`, `stageId`, `priority`, `lostReason`
(`null` clears it, a string sets it). A `stageId` change writes a
`pipeline_moved` activity on the deal's contact and stamps
`stageChangedAt`.

Response:
```json
{ "data": { "id": "...", "stageId": "won" } }
```

Pipeline stage ids (`src/types/deals.ts`): `new`, `contacted`, `qualified`,
`proposal`, `won` (terminal), `lost` (terminal).
Deal priorities: `high`, `medium`, `low`.

### `GET /api/agent/v1/templates`
**Scope:** `templates:read`

Query params: `subAccountId` (required), `type` (`email` | `sms`,
optional). Returns up to 100 templates.

Response:
```json
{
  "data": [
    { "id": "...", "type": "email", "name": "Welcome", "subject": "Hi {{firstName}}", "body": "..." }
  ]
}
```

### `POST /api/agent/v1/templates`
**Scope:** `templates:write`

Body: `subAccountId`, `type` (`"email"` | `"sms"`), `name`, `body`
(required); `subject` (required when `type` is `"email"`). Email bodies are
validated with `validateEmailBody` — they must contain the literal
`{{unsubscribeLink}}` merge tag or the call fails with
`400 VALIDATION_FAILED`.

Response `201`:
```json
{ "data": { "id": "..." } }
```

### `GET /api/agent/v1/templates/{id}`
**Scope:** `templates:read`

Returns one template. `404 NOT_FOUND` if the doc doesn't exist or belongs
to a sub-account the key isn't allowed to touch (same pattern as
contacts/deals).

### `PATCH /api/agent/v1/templates/{id}`
**Scope:** `templates:write`

Body (all optional): `name`, `subject` (email templates only; cannot be
blanked), `body` (re-validated against `{{unsubscribeLink}}` for email
templates).

Response:
```json
{ "data": { "id": "..." } }
```

### `POST /api/agent/v1/sequences`
**Scope:** `sequences:write`

Create an outbound sequence — a `recipeType: "outbound_sequence"` automation.
Body: `subAccountId`, `name` (required); `steps[]` (1-10 entries, each
`{ templateId, delaySeconds }`, `delaySeconds >= 0`); `tag` (optional — if
set, the sequence auto-enrolls any contact that gets this tag via
`tag_added`, in addition to manual/`enroll` calls); `enabled` (default
`true`). Every `templateId` must exist, belong to `subAccountId`, and be
`type: "email"` — sequences are email-only in v1 (SMS is excluded pending
A2P registration), or `400 VALIDATION_FAILED`.

Request:
```json
{
  "subAccountId": "DDEParISNUlxoMiimi2X",
  "name": "Cold outreach — box1",
  "tag": "box1",
  "enabled": true,
  "steps": [
    { "templateId": "tMKRva4xWmLOz0yqEvFq", "delaySeconds": 0 },
    { "templateId": "tMKRva4xWmLOz0yqEvFq", "delaySeconds": 345600 }
  ]
}
```

Response `201`:
```json
{ "data": { "id": "kMPnzWtTlFlAgWnJSzqX" } }
```

### `GET /api/agent/v1/sequences`
**Scope:** `sequences:write`

Query params: `subAccountId` (required). Lists up to 100 outbound-sequence
automations in the sub-account.

Response:
```json
{
  "data": [
    {
      "id": "kMPnzWtTlFlAgWnJSzqX",
      "name": "Cold outreach — box1",
      "enabled": true,
      "trigger": { "type": "tag_added", "formId": null, "tag": "box1" },
      "stepCount": 2
    }
  ]
}
```

### `POST /api/agent/v1/sequences/{id}/enroll`
**Scope:** `sequences:enroll`

This is the hard batch-approval gate (spec §5): the caller must resolve the
audience and prove it knew the count *before* the enroll actually runs.

Body: exactly one of `contactIds` (string[], 1-200) or `tag` (string) —
providing both or neither is `400 VALIDATION_FAILED`. `confirm.expectedCount`
(number, required) must equal the resolved audience size:
- `contactIds` path: `contactIds.length`.
- `tag` path: the live count of contacts in `subAccountId` with that tag
  (`array-contains`). If that count exceeds 200, the call fails loudly
  *before* touching any contact — `400 VALIDATION_FAILED`,
  `"Tag audience exceeds 200 contacts — enroll in batches via
  contactIds[], or split the tag."` (`details: { limit: 200 }`). This is
  deliberate: silently enrolling only the first 200 matches would leave
  the rest of the tagged audience permanently un-enrollable later (see
  the idempotent-forever note above), so an oversized tag audience must be
  split into `contactIds[]` batches or a narrower tag rather than resolved
  automatically.

If `confirm` is missing or `expectedCount` doesn't match, the call is
refused *before touching any contact* with:

```json
{
  "error": {
    "code": "CONFIRM_MISMATCH",
    "message": "confirm.expectedCount must equal the resolved audience size — re-check the batch with the operator before enrolling.",
    "details": { "expectedCount": null, "actualCount": 1 }
  }
}
```
`HTTP 409`. Observed live in the Task 13 smoke, verbatim above.

On a matching `confirm`, each resolved contact is enrolled via
`enrollContact` — deterministic execution id `${sequenceId}_${contactId}`,
created with `tx.create()` so a contact can never be enrolled in the same
sequence twice, ever (not while running, not after it completes, not after
it stops/replies). This is what makes tag-based auto-enrollment (below) and
manual re-enrollment both safe to call repeatedly.

Request:
```json
{ "tag": "box1", "confirm": { "expectedCount": 42, "summary": "cold outreach batch, approved by Star" } }
```

Response `201`, observed in the Task 13 smoke (re-enrolling an
already-enrolled contact):
```json
{ "data": { "enrolled": 0, "alreadyEnrolled": 1, "skipped": [] } }
```
`skipped[]` entries carry `{ contactId, reason }` — `reason` is
`"not_found"` (contact doesn't exist or belongs to another sub-account),
`"no_steps"` (sequence has no enabled steps), or `"failed"` (enrollment
attempted but the schedule call failed — see `qstashIsConfigured` note under
Environment variables below).

**Idempotency-Key** is supported (`withIdempotency`, per-call replay window
24h) and doubles as a cap preflight: a cached replay never re-consumes the
daily enrollment cap; a fresh `429 CAP_EXCEEDED` is never cached, so it
stays retryable once capacity frees up.

### `POST /api/agent/v1/sequences/{id}/unenroll`
**Scope:** `sequences:enroll`

Body: `contactIds` (string[], 1-200, required). For each id, if the
`${id}_${contactId}` execution exists and is `status: "running"`, sets it to
`status: "stopped", stoppedReason: "manual"`. Anything else (never enrolled,
already completed/stopped/failed) counts toward `notRunning`, not an error.

Response:
```json
{ "data": { "stopped": 1, "notRunning": 0 } }
```

### `GET /api/agent/v1/sequences/{id}/status`
**Scope:** `reports:read`

Aggregates up to 5,000 execution docs (`MAX_DOCS`-style cap, `.select()`
projection) for this sequence into status counts and a `stoppedReason`
breakdown.

Response, observed live at each stage of the Task 13 smoke:
```json
{
  "data": {
    "sequence": { "id": "kMPnzWtTlFlAgWnJSzqX", "name": "bridge-smoke-2 sequence", "enabled": true },
    "counts": { "running": 0, "completed": 0, "stopped": 1, "failed": 0 },
    "stoppedReasons": { "replied": 1 }
  }
}
```
`stoppedReasons` values: `"manual"` (via `/unenroll`), `"replied"` (via the
inbound webhook's stop-on-reply — see below), `"opt_out"`, `"booking"`
(shared with other recipe types), `"automation_disabled"` (QStash publish
failed at enrollment/start time).

### `GET /api/agent/v1/replies`
**Scope:** `replies:read`

Query params: `subAccountId` (required), `limit` (1-100, default 20),
`handled` (`"false"` to filter to unhandled only — any other value or
omitted returns all).

Response, observed in the Task 13 smoke:
```json
{
  "data": [
    {
      "id": "smoke-email-t13-...",
      "contactId": "kHJ4OuW2tiYKyNKcgsHD",
      "fromEmail": "bridge-smoke-2+t13@example.com",
      "subject": "Re: Smoke test",
      "text": "Sounds good, let's talk.",
      "handled": false,
      "matchedBy": "email_lookup",
      "receivedAt": { "_seconds": 1783717456, "_nanoseconds": 808000000 }
    }
  ]
}
```
`matchedBy` is `"reply_token"` when the signed `reply+<token>@domain`
address matched, or `"email_lookup"` when it fell back to a unique
from-email match (or when no token was present at all). Token capture is
case-preserving, so `"reply_token"` is the expected match for any reply
sent to the signed address, including mixed-case Firestore contact IDs;
`"email_lookup"` remains the fallback for tokenless replies.

### `PATCH /api/agent/v1/replies/{id}`
**Scope:** `replies:write`

Body: `{ "handled": true | false }` (required, boolean). `404 NOT_FOUND` if
the doc doesn't exist or belongs to a sub-account the key isn't allowed to
touch (same doc-ID-resolved-tenant pattern as contacts/deals/templates).

Response:
```json
{ "data": { "id": "smoke-email-t13-...", "handled": true } }
```

### `POST /api/webhooks/resend-inbound`
**Not part of the `agent/v1` namespace** — this is the inbound side of
outbound sequences, called by Resend, not by the agent. Documented here
because it's the mechanism behind Replies/stop-on-reply above.

Faces the open internet. Every request is Svix-signature-verified
(`src/lib/webhooks/svix-verify.ts`, HMAC-SHA256 over
`${svix-id}.${svix-timestamp}.${rawBody}` using the base64-decoded portion
of `RESEND_INBOUND_WEBHOOK_SECRET` after its `whsec_` prefix) before any
Firestore access.

- **`503`** — `RESEND_INBOUND_WEBHOOK_SECRET` isn't set on this deployment.
  `{ "error": "not configured" }`.
- **`401`** — signature missing/invalid/stale (5-minute tolerance on
  `svix-timestamp`). `{ "error": "bad signature" }`.
- **`200`** always after that, even on internal ingestion failures — Resend
  retries on non-2xx, and a downstream bug here must not trigger unbounded
  retries. `{ "ok": true, "matched": boolean }` on success,
  `{ "ok": false }` on a caught internal error, `{ "ok": true, "ignored": true }`
  for a non-`email.received` event or an unparseable body.

Matching (`matchContact`, in order):
1. A `reply+<contactId>.<hmac12>@<INBOUND_REPLY_DOMAIN>` address in `to` —
   verified via `verifyReplyToken` (`src/lib/automations/reply-token.ts`),
   then confirmed against a real `contacts/{id}` doc. Wins outright over
   the fallback below.
2. Otherwise, a from-email lookup: exactly one contact in Firestore with
   `email == fromEmail` (0 or 2+ matches = unmatched).

On a match: writes an `email_reply` activity on the contact; stops every
`status: "running"` execution for that contact **whose automation is
`recipeType: "outbound_sequence"`** only (`lead_nurture` and other recipe
types keep running — a mid-nurture reply isn't "done"), setting
`status: "stopped", stoppedReason: "replied"` and logging an
`automation_completed` activity; best-effort forwards a copy to the
sub-account's `replyToEmail` if `emailIsConfigured()` and one is set. The
inbound event is always stored as an `inbound_emails` doc (`id` = Resend's
`email_id` when present, so a Resend redelivery of the same email
overwrites in place and resets `handled` to `false` — a documented,
deliberate dedupe tradeoff, not a bug).

The reply-token address format is `reply+<contactId>.<12-hex-char
HMAC>@domain` (`buildReplyToken`/`resolveSequenceReplyTo`,
`src/lib/automations/reply-token.ts`, `sequence-reply-to.ts`) — built by
the *executor* when it sends a sequence step, using
`AUTOMATIONS_TOKEN_SECRET`. The webhook rebuilds the same HMAC to verify
it. Token capture is case-preserving end to end, so this matches correctly
for mixed-case Firestore document IDs; the from-email lookup remains the
fallback for tokenless replies.

### `POST /api/agent/v1/messages/email`
**Scope:** `sends:execute`

Body: `contactId`, `subject`, `body` (all required, plain text — no
template/merge-tag resolution happens in this route). Sends immediately via
Resend using the sub-account's `replyToEmail` if set.

Guards, in order: `503 SEND_FAILED` if email isn't configured on this
deployment; `404 NOT_FOUND` if the contact doesn't exist *or* belongs to a
sub-account the key isn't allowed to touch (see 404/403 semantics above);
`400 VALIDATION_FAILED` if the contact has no email; `409
CONTACT_OPTED_OUT` if `emailOptedOut: true`. Idempotency replay is checked
next — a replayed `Idempotency-Key` returns the cached response without
re-running any of the following checks. Only then: `429 CAP_EXCEEDED` at
100 sends/key/day (never cached — always retryable once capacity frees
up); `502 SEND_FAILED` if the provider call itself throws.

On success, writes an `email_sent` activity on the contact and records send
usage via `recordSend`.

Response `200`:
```json
{ "data": { "id": "<provider-message-id>" } }
```

**Not exercised in the Task 14 smoke** — the smoke key was deliberately
minted without `sends:execute` so no email could go out against production
data. Behavior above is read directly from `src/app/api/agent/v1/messages/email/route.ts`.

### `GET /api/agent/v1/reports/summary`
**Scope:** `reports:read`

Query params: `subAccountId` (required). Aggregates up to 5,000 contacts and
5,000 deals per sub-account (`MAX_DOCS`) via `select()` projections.

Response, observed in smoke test:
```json
{
  "data": {
    "contacts": { "total": 42, "byStage": { "none": 41, "new": 1 }, "emailOptedOut": 0 },
    "deals": { "total": 0, "byStage": {}, "valueByStage": {} }
  }
}
```

Unhandled failures return `500 INTERNAL_ERROR` (the only route in Phase 1
that emits this code).

### `GET /api/agent/v1/control-plane/summary`
**Scope:** `control_plane:read`

Read-only Revenue OS health snapshot for the MyUSA OS control plane
(spec: `myusa-founder-hq/docs/control-plane/ugotleads-control-plane-spec.md`).
Agency-scoped — no `subAccountId` param; the key's sub-account allowlist does
not apply. Returns bounded per-domain counts (up to 2,000 docs per collection;
`truncated: true` when a bound is hit — counts are floors, not exact) plus the
launch-readiness checklist computed by `src/lib/readiness/compute.ts`, the
same code path as the owner cockpit's `GET /api/agency/readiness`, so the two
surfaces cannot drift. Env checks reflect the deployment serving the request.
Secrets are reported as booleans only. No PII, no BYOK key material.

Response `200`:
```json
{
  "data": {
    "counts": {
      "products": { "total": 3, "activePublic": 1 },
      "purchases": { "total": 12, "paid": 11 },
      "entitlements": { "total": 11, "active": 11 },
      "partners": { "total": 2, "active": 1 },
      "commissions": { "pending": 0 },
      "creditWallets": { "total": 2 },
      "partnerEvents": { "pending": 0, "failed": 0 }
    },
    "readiness": {
      "env": { "isProd": true },
      "summary": { "blockers": 0, "warnings": 1, "total": 12 },
      "checklist": [ { "key": "stripe_keys", "label": "…", "severity": "ok", "detail": "…" } ]
    },
    "truncated": false
  }
}
```

### `GET /api/agent/v1/control-plane/issues`
**Scope:** `control_plane:read`

Read-only normalized issue rows. Runs equality-only detectors across seven
domains and returns rows sorted severity-first (critical → warning → info),
deterministically tie-broken by domain, code, and entity id. Strictly
read-only: rows carry a `safe_action_url` (path into the uGotLeads admin UI,
no tokens, no mutations) for a human to act on.

Query params (all optional):
- `domain` — one of `products`, `fulfillment`, `partners`, `commissions`,
  `credits`, `byok`, `partner_events`
- `severity` — one of `info`, `warning`, `critical`
- `limit` — integer 1–200, default 50

Invalid values return `400 VALIDATION_FAILED`.

Issue codes by domain:

| Domain | Code | Severity | Meaning |
|---|---|---|---|
| products | `subscription_product_missing_price` | critical (public) / warning | Active subscription product with no Stripe price ID |
| products | `draft_product_public` | warning | Draft product flagged public |
| fulfillment | `paid_purchase_unfulfilled` | critical | Paid purchase with no `fulfilledAt` |
| partners | `partner_missing_referral_code` | warning | Active/approved partner without a referral code |
| partners | `suspended_partner_pending_commissions` | warning | Suspended/terminated partner holding pending commission cents |
| commissions | `commission_past_hold` | warning | Pending commission whose `holdUntil` has passed |
| commissions | `commission_on_unpaid_purchase` | critical | Purchase carries a `commissionEventId` but `paymentStatus` is not `paid` |
| credits | `wallet_negative_balance` | critical | Wallet balance below 0 (invariant break) |
| credits | `active_partner_missing_wallet` | warning | Active partner with no `credit_wallets` doc |
| byok | `byok_not_configured` | warning | Approved BYOK eligibility with `byokConfigured !== true` — read from `product_eligibility` safe mirrors ONLY, never `byok_keys` |
| partner_events | `partner_event_failed` | critical | Outbox event in `failed` status |
| partner_events | `partner_event_stuck_pending` | warning | Pending event older than 7 days or ≥5 export attempts |

Response `200`:
```json
{
  "data": {
    "issues": [
      {
        "domain": "fulfillment",
        "issue_code": "paid_purchase_unfulfilled",
        "source_entity_type": "purchase",
        "source_entity_id": "cs_…",
        "display_name": "CRM Pro",
        "status": "paid_unfulfilled",
        "severity": "critical",
        "summary": "Paid purchase of \"CRM Pro\" has no fulfillment — …",
        "safe_action_url": "/agency/marketplace-purchases",
        "metadata": { "hasEntitlementId": false }
      }
    ],
    "total": 1,
    "truncated": false
  }
}
```

`truncated: true` means either a detector query hit its 2,000-doc bound or
`total` exceeds `limit` — treat the list as incomplete either way.

## Scopes

Full scope union (`src/types/service-keys.ts`):

```
contacts:read, contacts:write, deals:write, templates:read, templates:write,
sends:execute, reports:read, sequences:write, sequences:enroll,
replies:read, replies:write, control_plane:read
```

`control_plane:read` gates the two read-only `/control-plane/*` routes above.
It is agency-scoped (ignores the sub-account allowlist), exposes no secret
values and no PII, and has no write counterpart by design — control-plane
write-back is explicitly deferred per the MyUSA OS control plane spec.

The last four (`sequences:write`, `sequences:enroll`, `replies:read`,
`replies:write`) were reserved placeholders through Phase 1; Phase 2 wires
them up to the Sequences and Replies endpoints above.

## Environment variables (Phase 2 additions)

| Var | Required for | Behavior when unset |
|---|---|---|
| `RESEND_INBOUND_WEBHOOK_SECRET` | Verifying `POST /api/webhooks/resend-inbound` signatures | Webhook returns `503 { "error": "not configured" }` on every request — no inbound replies are ingested, so stop-on-reply never fires |
| `INBOUND_REPLY_DOMAIN` | Building `reply+<token>@<domain>` addresses (executor send path, `resolveSequenceReplyTo`) | Sequence sends fall back to the sub-account's plain `replyToEmail` (or provider default) — replies still land in the inbox, but the webhook can't token-match them (falls to from-email lookup only) |
| `AUTOMATIONS_TOKEN_SECRET` | Signing/verifying reply tokens (`reply-token.ts`) — same secret already used for unsubscribe links | If unset or under 16 chars, `buildReplyToken`/`verifyReplyToken` both degrade to "no token" rather than throwing — sends use the plain reply-to, and the webhook only ever matches by from-email |

All three already exist as local-dev-only additions during Task 13 (never
committed — `.env.local` is gitignored); see `docs/OUTBOUND_SEQUENCES.md`
for the production Vercel setup.

## Key management (for operators)

Two ways to mint a service key, both writing to the `agencyServiceKeys`
collection:

1. **CLI script** — `node scripts/mint-service-key.mjs --label <label>
   --sub-account <subAccountId> --scopes <comma,separated,scopes>`. Reads
   `FIREBASE_ADMIN_*` from `.env.local`, prints the plaintext key once. Used
   for the very first key (or any key minted outside a browser session) so
   it doesn't require an owner to be logged in.
2. **Owner-session routes** — `POST /api/agency/service-keys` (body:
   `label`, `allowedSubAccounts[]`, `scopes[]`) and `GET
   /api/agency/service-keys` (list, no plaintext) for agency owners
   authenticated via the dashboard session. `DELETE
   /api/agency/service-keys/{id}` revokes a key by setting
   `status: "revoked"` — same effect as the manual Firestore edit used in
   this task's cleanup.

The plaintext key (`ugl_<40 hex chars>`) is shown exactly once at mint time
and is never stored — only its SHA-256 hash (`keyHash`) and an 8-char
`keyPrefix` for display/audit are persisted.

## Notes

**Composite-index requirement for tag search.** The Task 14 smoke ran `GET
/contacts?subAccountId=...&tag=bridge-smoke` against production Firestore
and it returned `200` cleanly with no index prompt. This query combines an
equality filter (`subAccountId ==`) with an `array-contains` filter
(`tags`), which Firestore can serve with a single-field-per-clause plan
without a composite index when there are only two clauses total. A
composite index becomes necessary if a future caller combines `tag` with
another `where` (e.g. `tag` + `pipelineStage` + `email` all at once) —
route code already supports stacking those filters
(`src/app/api/agent/v1/contacts/route.ts`). If that happens, Firestore
returns a `FAILED_PRECONDITION` error containing a direct console link to
create the missing index; per this project's operating rules, do not create
that index automatically — surface the error and link to a human operator.

**Duplicate-contact detection under concurrency.** `POST /contacts` and
`POST /contacts/import` currently dedupe on `(subAccountId, email)` by
running a query inside a `runTransaction` (query for an existing match,
write if none found). This is documented in `idempotency.ts` as
"acceptable for v1 — the caller is a single orchestrator, not a fleet":
Firestore transactions don't guarantee serializability against a *query*
the way they do against a directly-read document, so two truly concurrent
create calls for the same email from independent callers can both pass the
duplicate check and both write. If Phase 2 introduces multiple concurrent
orchestrators (or a fleet of workers) hitting the same sub-account, the
fix is a sentinel-document uniqueness constraint: write a doc at
`contactEmails/{subAccountId}_{sha256(email)}` using `tx.create()` (which
throws `ALREADY_EXISTS` if the doc id is taken) as the true uniqueness
guard, then create the contact doc only after the sentinel create succeeds.
Firestore enforces document-id uniqueness atomically regardless of query
races, so this closes the gap the current implementation accepts.

**`fireTriggers`' compound query needs no composite index (confirmed live).**
`tag_added`/`form_submit` matching (`src/lib/automations/triggers.ts`)
queries `automations` on `subAccountId ==`, `enabled ==`, and
`trigger.type ==` — three equality clauses, no range/array-contains mixed
in. The Task 13 smoke fired this query live against production Firestore
(tagging a real contact, which calls `fireTagAddedTriggers` →
`fireTriggers`) and it returned cleanly with no `FAILED_PRECONDITION` —
Firestore serves multi-equality queries without a composite index. No
index was created or needed.

**QStash is unconfigured in local dev by design — enrollment can't be
smoke-tested end-to-end without it.** `QSTASH_TOKEN` (and the signing keys)
are blank in `.env.local` on this project intentionally
(`src/lib/automations/qstash.ts`: *"keeps local dev workable without live
QStash credentials, at the cost of automations not firing"*). Consequence
for `enrollContact`: when `qstashIsConfigured()` is false, a *first-time*
enrollment always deletes its own execution doc and returns `"failed"` —
there's no way to observe a genuine `"enrolled"` outcome locally. The Task
13 smoke worked around this by seeding an `automation_executions` doc
directly via the Admin SDK (simulating what a working-QStash environment
produces) before exercising the tag-trigger and manual-enroll paths — both
then legitimately hit the real `ref.create()` collision and return
`"already_enrolled"` through the actual route code, which is what the
`enrolled: 0, alreadyEnrolled: 1` responses shown above reflect. This
proves the idempotency/collision logic and the confirm-gate for real; it
does not exercise a fresh `publishStep` call succeeding. That path is
covered by the mocked-QStash unit tests in
`src/lib/automations/__tests__/sequence-engine.test.ts` and
`sequences-enroll.test.ts`, not by this live smoke.

**Unrelated dev-server noise.** During the Task 14 smoke, the local dev
server logged a recurring `gitpage/heartbeat` fetch failure
(`src/lib/gitpage/heartbeat.ts:151`, `Failed to parse URL from
/api/v1/leadstack/heartbeat`) on an unrelated background interval. It is
pre-existing and unrelated to the agent-api routes added in this phase —
noted here for completeness, not something this task fixed.

**`reports/summary` under-reports beyond 5,000 docs.** The route reads at
most `MAX_DOCS` (5,000) documents per collection (contacts, deals) per
sub-account. Totals, `byStage`, and `valueByStage` are computed only over
that capped read — for a sub-account with more than 5,000 contacts or
deals, the reported totals will be lower than the true count with no
indication in the response that the result was truncated. Fine for Phase 1
scale; revisit with real pagination/aggregation if a sub-account approaches
the cap.

## Notes / Deviations

- **Daily send cap is a hardcoded constant, not per-key config.** The
  original spec sketched the daily send cap as a value stored on each
  service key's document (so different keys/agencies could have different
  limits). The Phase 1 implementation (`DAILY_SEND_CAP` in
  `src/app/api/agent/v1/messages/email/route.ts`) hardcodes it to 100
  sends/key/day for every key, with no per-key override. Revisit in Phase 2
  if per-agency or per-key limits are needed.
