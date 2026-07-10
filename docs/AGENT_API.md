# Agent API v1 Reference

Phase 1 reference for the machine-to-machine "agent bridge" API. This is the
input contract for the Phase 3 MCP server — every endpoint below is grounded
in the actual route source under `src/app/api/agent/v1/`, not the original
spec (some scopes and one route were adjusted during implementation; see
Notes).

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
the scope required by the endpoint returns `403 SCOPE_MISSING`. A key used
against a sub-account it isn't allowed to touch returns
`403 SUB_ACCOUNT_FORBIDDEN`.

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
| `CONFIRM_MISMATCH` | — | Reserved; not currently emitted by any Phase 1 route |
| `SEND_FAILED` | 502 / 503 | Email provider not configured, or the send itself failed |
| `INTERNAL_ERROR` | 500 | Unhandled server-side failure (currently only `reports/summary`'s catch block) |

## Caps

| Cap | Limit | Enforced in |
|---|---|---|
| Sends per key per UTC day | 100 | `POST /messages/email` via `enforceDailyCap` (`src/lib/agent-api/caps.ts`) |
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

Returns the full contact record including `subAccountId`. 404s if the doc
doesn't exist; 403 `SUB_ACCOUNT_FORBIDDEN` if it exists but the key isn't
allowed on its sub-account.

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

Returns one template. `404 NOT_FOUND` / `403 SUB_ACCOUNT_FORBIDDEN` follow
the same pattern as contacts/deals.

### `PATCH /api/agent/v1/templates/{id}`
**Scope:** `templates:write`

Body (all optional): `name`, `subject` (email templates only; cannot be
blanked), `body` (re-validated against `{{unsubscribeLink}}` for email
templates).

Response:
```json
{ "data": { "id": "..." } }
```

### `POST /api/agent/v1/messages/email`
**Scope:** `sends:execute`

Body: `contactId`, `subject`, `body` (all required, plain text — no
template/merge-tag resolution happens in this route). Sends immediately via
Resend using the sub-account's `replyToEmail` if set.

Guards, in order: `503 SEND_FAILED` if email isn't configured on this
deployment; `404 NOT_FOUND` if the contact doesn't exist; `403
SUB_ACCOUNT_FORBIDDEN` if the key can't access the contact's sub-account;
`400 VALIDATION_FAILED` if the contact has no email; `409
CONTACT_OPTED_OUT` if `emailOptedOut: true`; `429 CAP_EXCEEDED` at 100
sends/key/day; `502 SEND_FAILED` if the provider call itself throws.

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

## Scopes

Full scope union (`src/types/service-keys.ts`); Phase 1 routes use the
first seven, the rest are reserved for Phase 2 (sequences/replies) so the
type doesn't churn later:

```
contacts:read, contacts:write, deals:write, templates:read, templates:write,
sends:execute, reports:read, sequences:write, sequences:enroll,
replies:read, replies:write
```

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

**Unrelated dev-server noise.** During the Task 14 smoke, the local dev
server logged a recurring `gitpage/heartbeat` fetch failure
(`src/lib/gitpage/heartbeat.ts:151`, `Failed to parse URL from
/api/v1/leadstack/heartbeat`) on an unrelated background interval. It is
pre-existing and unrelated to the agent-api routes added in this phase —
noted here for completeness, not something this task fixed.
