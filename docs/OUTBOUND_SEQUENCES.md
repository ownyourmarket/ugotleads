# Outbound Sequences — Operator Setup Guide

Outbound sequences let an agent (or you, via curl/scripts today — see "What
still needs Phase 3" below) enroll cold contacts in a multi-step email drip,
and automatically stop that drip the moment the contact replies. This guide
is the one-time setup plus the day-to-day mental model. For the exact
request/response shapes, see `docs/AGENT_API.md`'s Sequences and Replies
sections.

## 1. Resend inbound setup (one-time)

This wires up the "a human replied" half of the feature. Without it,
sequences still send fine — they just never stop on reply.

1. Log into the [Resend dashboard](https://resend.com) → **Domains** →
   select `hey.ugotleads.io` (or add it if it isn't there yet).
2. Enable **inbound receiving** on that domain. Resend will show you an MX
   record — a host, a value, and a priority.
3. Copy that MX record **verbatim** into Namecheap's DNS panel for
   `ugotleads.io` (Advanced DNS → Add New Record → MX Record, host =
   `hey`, value/priority = exactly what Resend showed you). DNS
   propagation can take up to an hour — don't panic if inbound mail
   doesn't work immediately.
4. Back in Resend → **Webhooks** → **Add Webhook**:
   - Endpoint URL: `https://app.ugotleads.io/api/webhooks/resend-inbound`
   - Event: `email.received`
5. Resend shows you a signing secret starting with `whsec_…` the moment you
   create the webhook. **Copy it now** — this is `RESEND_INBOUND_WEBHOOK_SECRET`
   below, and Resend does not show it to you again after you navigate away.

## 2. Vercel environment variables (Production)

Add these two, then redeploy:

| Variable | Value |
|---|---|
| `RESEND_INBOUND_WEBHOOK_SECRET` | `whsec_…` from step 1.5 above |
| `INBOUND_REPLY_DOMAIN` | `hey.ugotleads.io` |

**Paste-ready:**
```
vercel env add RESEND_INBOUND_WEBHOOK_SECRET production
# paste the whsec_... value when prompted

vercel env add INBOUND_REPLY_DOMAIN production
# paste: hey.ugotleads.io
```
(Or Vercel dashboard → Project → Settings → Environment Variables → add
both, scoped to Production → **Redeploy**.)

**Check `AUTOMATIONS_TOKEN_SECRET` is already set in Production before you
rely on any of this.** It should be — it's the same secret that's been
signing unsubscribe links since before this phase — but it's worth a
30-second check (Vercel dashboard → Settings → Environment Variables →
search `AUTOMATIONS_TOKEN_SECRET`, confirm it exists for Production). If
it's missing, sequence sends still work, but every reply-to address falls
back to the sub-account's plain reply-to email instead of the signed
`reply+<token>@hey.ugotleads.io` format, and the webhook can only match
replies by from-email lookup (works, but weaker — see the case-sensitivity
note below).

**Per the automation rules: a missing env var in the production dashboard
is the #1 cause of "it worked locally but not in prod."** Do this step
*before* you tell anyone stop-on-reply is live. Until both vars are set:
- Sequence emails still send fine, using the sub-account's plain
  `replyToEmail` (or provider default) instead of a per-contact token
  address.
- The webhook endpoint returns `503` on every request (config guard, see
  `docs/AGENT_API.md`) — Resend will retry and eventually give up, and no
  reply ever stops a sequence or shows up in `/replies`.
- Everything else in this doc (creating sequences, enrolling contacts, the
  confirm-gate, unenroll, status) works today regardless of these two vars.

## 3. How a campaign runs

1. **Create templates.** `POST /api/agent/v1/templates` — email type, must
   include `{{unsubscribeLink}}` in the body (enforced, `400` if missing).
2. **Create the sequence.** `POST /api/agent/v1/sequences` — name, 1-10
   steps (each a template + delay in seconds from enrollment), and an
   optional `tag` (a contact getting this tag auto-enrolls; matches
   `box1`-style tagging conventions already used elsewhere). Give it a tag
   that means something to you — `box1`, `q3-outreach`, whatever the
   campaign is.
3. **Import or tag contacts.** Whatever gets a contact this sequence's tag
   — `POST /api/agent/v1/contacts` with `tags`, `PATCH
   /api/agent/v1/contacts/{id}` with `addTags`, a CSV import, or the
   dashboard — auto-enrolls it the moment the tag lands (subject to the
   confirm-gate below if you're enrolling by tag through the agent API
   directly).
4. **The agent proposes the batch, you approve the count.** This is the
   hard gate, not a suggestion: `POST /sequences/{id}/enroll` refuses to
   enroll anyone unless the caller passes
   `confirm: { expectedCount: N, summary: "..." }` where `N` exactly
   matches the resolved audience size (by `contactIds[]` or by `tag`
   count). Get a mismatch, get a `409 CONFIRM_MISMATCH` — nothing is
   touched. This exists so an agent (or a bug) can't silently blast a
   sequence at "however many contacts happen to match right now" — the
   count has to be named and confirmed first.
5. **Replies stop sequences automatically and appear in your inbox.** Once
   step 1-2 above are live: a contact's reply gets ingested by the webhook,
   stops every running `outbound_sequence` execution for that contact
   (other automation types keep running — a reply doesn't mean "stop
   everything," it means "this cold sequence did its job"), and — if the
   sub-account has a `replyToEmail` configured — forwards a copy there so a
   human sees it without needing to check `/replies`. Either way, it's
   queryable: `GET /api/agent/v1/replies?subAccountId=...&handled=false`.
   Mark it read with `PATCH /api/agent/v1/replies/{id} { "handled": true }`.

## 4. Kill switches

Read this before you flip anything — both of the sequence-level switches
below are **terminal**, not a pause button. Know that going in.

From least to most drastic:

- **Unenroll specific contacts.** `POST /sequences/{id}/unenroll` with
  `contactIds[]` — stops just those, `stoppedReason: "manual"`.
- **Disable the sequence.** Toggle `enabled: false` on the automation (via
  the dashboard's automations page, or a direct PATCH if/when that route
  exists). This does **not** let in-flight contacts finish. The executor
  checks `enabled` on every step it processes, so a disabled automation
  permanently stops every currently-running execution the next time it
  would have sent — it does not defer or resume when you re-enable.
- **Sub-account-wide pause.** `automationsPaused: true` on the sub-account
  doc — the operator panic button. `fireTriggers` checks this before doing
  anything, so it blocks *all* new trigger-based enrollments (any recipe
  type), not just this sequence. But it is **also terminal for executions
  already running**, not a soft pause: the executor stops any in-flight
  step the same way `enabled: false` does. There is no state where
  execution is "paused" and will pick back up later.
- **Unsubscribe links.** Always present (`{{unsubscribeLink}}` is a
  required merge tag in every email template) — a contact can always opt
  themselves out regardless of what any of the above are set to.

**The part that catches people out:** enrollment is idempotent-forever —
`enrollContact` creates the execution doc with `tx.create()` keyed on
`${sequenceId}_${contactId}`, so a contact can never be enrolled in the
same sequence twice, ever. Once `enabled: false` or
`automationsPaused: true` has stopped a contact's execution, that contact
is **permanently done with that sequence** — re-enabling the automation or
un-pausing the sub-account will not, and cannot, re-enroll them. There is
no "resume where it left off."

**How to actually pause outbound volume temporarily**, then, without
burning your enrolled audience:
- Prefer the **send-window** — sends outside the configured window defer
  to the next open window rather than stopping anything. This is the only
  built-in mechanism that behaves like a real pause.
- If you do need to stop sends right now, accept that `enabled: false` /
  `automationsPaused: true` ends the current enrollments for good. Plan to
  re-launch as a **new sequence** (new automation doc, new
  `${sequenceId}_${contactId}` keys) against a fresh audience when you're
  ready to resume — don't expect the old one to pick back up.

## 5. What still needs Phase 3

There is no dashboard UI for sequences yet — this is deliberate, not an
oversight (agent-API-only until operators actually need a UI; Phase 4
dogfooding will tell us if that's true). Until the `/outreach` orchestrator
and its MCP tools land in Phase 3, running a campaign means Claude (or
whoever's driving) calls these endpoints directly via curl or a small
script — exactly like the Task 13 smoke did. Practically:

- Minting a service key: `node scripts/mint-service-key.mjs --label
  <label> --sub-account <id> --scopes sequences:write,sequences:enroll,...`
- Everything after that is `curl` against `docs/AGENT_API.md`'s Sequences
  and Replies sections.

## Reply-token matching

Token capture is case-preserving, so the signed
`reply+<contactId>.<hmac>@hey.ugotleads.io` reply-to address matches
correctly for mixed-case Firestore contact IDs — `matchedBy: "reply_token"`
is the expected outcome for any reply sent to that address. The from-email
lookup (`matchedBy: "email_lookup"`) remains the fallback for tokenless
replies or a `to` address that doesn't parse as a token.
