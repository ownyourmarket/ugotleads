# Trading OS Module — Build Plan / Module Spec

**Status:** Phase A scaffolded in this branch — pending the Vibe service + review.
**Owner:** Star Riley / MyUSA
**Prepared by:** Code Engineer + Founder-Operator Advisor + Compliance Reviewer (SOUL agents)
**Repo:** `ownyourmarket/ugotleads`
**Branch:** `claude/vibe-trading-hedge-fund-tgjhiy`

> The spec below is the design. Phase A (the uGotLeads-side integration) is now
> **built on this branch** — types, service client, Firestore model + rules, API
> routes, and the `/sa/[id]/trading` UI. It stays inert until the external Vibe
> service is stood up and its env vars are set (disables cleanly, 503 + friendly
> message when unconfigured). Phase B remains lawyer-gated and unbuilt.

## Decisions locked (build kickoff)

1. **Host: Railway.** Chosen over Fly.io because the Vibe service is meant to be
   one node in a broader platform of self-hosted, multi-use services (n8n +
   agentic workflows + SaaS). Railway's project-with-many-services model, official
   n8n template, and managed persistent Postgres/Redis make it the better substrate
   for that than Fly's edge/ops-heavy `fly.toml` + volumes model. Fly wins on global
   low-latency edge — not what this workload needs.
2. **Broker scope: paper now, self-directed live later.** Phase A ships
   `research_only` + `paper` modes. The data model already carries a
   `brokerConnections` concept and a `live` mode so users can later **connect and
   log into their OWN brokerage account** (Alpaca first) and place trades
   **themselves**. That self-directed path stays software-side — the user pulls the
   trigger, the agent never does — which is distinct from us trading for them
   (that's Phase B). `live` is gated behind an agency flag +
   an explicit per-user broker connection and is not selectable from the Phase A UI.

---

## 0. TL;DR

We add a new box to the uGotLeads OS — the **Trading OS module** — powered by
[HKUDS/Vibe-Trading](https://github.com/HKUDS/Vibe-Trading) running as a separate
Python service that uGotLeads calls over HTTPS, exactly like it already calls
Firecrawl, gitpage, and OpenRouter.

We build it in **two phases with a hard wall between them**:

- **Phase A (Lane A) — ships in ~4–6 weeks.** A per-sub-account AI **research,
  strategy, backtesting, and risk-analysis workspace**. It **never touches client
  money and never executes discretionary trades.** This is software + resources.
  It is the revenue product.
- **Phase B (Lane B) — lawyer-gated, months out, separate track.** Any form of
  discretionary trading, managed accounts, or pooled capital ("a hedge fund").
  This requires securities counsel and an entity/licensing build **before** any
  execution code. Phase A's engine is reused; the regulatory posture is not.

The engineering is the same in both phases. The **legal exposure is not.** Phase A
is what serves the tokenmaxxing bucket (new recurring revenue) inside 30–60 days.

---

## 1. The regulatory line (read this first)

This is the single most important section. It governs everything below.

### What keeps us in "software + resources" (Lane A / Phase A)

The compliance-reviewer SOUL positions the whole platform as a **software license +
resource-access program**, not a franchise, business opportunity, or income
guarantee. The Trading OS module stays inside that positioning **only if all of
these hold**:

1. **No discretion.** The agent never places a trade on a client's behalf. It
   produces research, strategies, backtests, Monte Carlo runs, and risk reports.
   The human decides and executes on their **own** broker.
2. **No custody.** We never hold, move, or have withdrawal access to client funds.
3. **No pooling.** We never combine multiple clients' capital into a fund.
4. **No personalized advice-for-a-fee framed as a recommendation.** Output is
   framed as research and educational analysis, not "you should buy X."
5. **Disclaimers on every surface.** "For research and educational purposes only.
   Not investment advice. Past performance does not guarantee future results.
   Trading involves risk of loss."
6. **Read-only / paper-trading defaults.** Any broker connection defaults to
   read-only history import or paper trading. Live-execution wiring is Phase B.

### What crosses the line into regulation (Lane B / Phase B)

The moment **any** of these is true, we are no longer selling software:

- An agent executes trades on someone else's account → **discretionary investment
  adviser** (Form ADV / RIA registration, SEC or state).
- We pool client capital → **private fund** (LP/LLC + GP entity, fund
  administrator, custody rule, accredited-investor gating under Reg D 506,
  likely a broker-dealer relationship).
- We give personalized investment recommendations for compensation → **investment
  adviser** regardless of pooling.

**Phase B cannot be scoped as a build task.** The correct first step for Phase B is
a securities attorney, not a commit. This document specifies Phase A in full and
Phase B only as a set of *requirements to hand a lawyer*.

> Per SOUL boundaries: we do not promise returns, do not project income, and do not
> give legal or tax advice. Phase B legal structure is out of scope for
> engineering until counsel has signed off.

### Compliance copy discipline

Every piece of marketing or in-app copy for this module must go through the
compliance-reviewer pass **before** it ships. Banned framing: "guaranteed
returns," "passive income," "we trade for you" (in Phase A), "proven system" +
return numbers without the earnings disclaimer. Approved framing: "AI trading
research workspace," "backtest your strategies," "risk analysis," "software +
resource access."

---

## 2. Where it sits in the 3-box OS

Per CLAUDE.md, uGotLeads is the client-facing platform; the Revenue OS module
lives *inside* it. The Trading OS module is a **new sibling module inside
uGotLeads**, not a separate product and not Founder HQ. Refer to it as **"the
Trading OS module inside uGotLeads."**

It mirrors the **AI Agents** architecture almost one-for-one:

| AI Agents concept | Trading OS equivalent |
|---|---|
| External LLM gateway (OpenRouter) | External engine (Vibe Trading service) |
| `subAccounts/{id}/aiAgent/profile` | `subAccounts/{id}/tradingAgent/profile` |
| `subAccounts/{id}/aiAgent/{channel}` | `subAccounts/{id}/tradingRuns/{runId}` |
| Firecrawl KB scrape (async, capped) | Vibe research/backtest job (async, QStash-polled) |
| `/api/sub-accounts/[id]/ai-agent/*` | `/api/sub-accounts/[id]/trading/*` |
| `/sa/[id]/ai-agents/*` UI | `/sa/[id]/trading/*` UI |
| `lib/firecrawl/client.ts` wrapper | `lib/vibe-trading/client.ts` wrapper |

---

## 3. Service topology

Vibe Trading is Python / LangGraph / LangChain. uGotLeads is Next.js 15 /
TypeScript / Firestore. **We do not embed Python into Next.js.** Instead:

```
┌─────────────────────────┐        HTTPS (Bearer key)        ┌──────────────────────────┐
│  uGotLeads (Vercel)      │  ───────────────────────────▶   │  Vibe Trading service    │
│  Next.js / TS / Firestore│                                  │  Python / LangGraph      │
│                          │  ◀───────────────────────────   │  Docker: Fly.io/Railway  │
│  lib/vibe-trading/client │        job submit + poll         │  exposes API/MCP server  │
└──────────┬───────────────┘                                  └────────────┬─────────────┘
           │                                                                │
           │ QStash reschedules poll every ~15s until terminal              │
           │ (identical to the gitpage website-build poll loop)             │
           ▼                                                                ▼
   Firestore: tradingRuns/{runId}                              18+ market data sources,
   (config + results, per sub-account)                         400+ quant strategies,
                                                                backtest + MC engines
```

- **One agency-level key** (`VIBE_TRADING_API_KEY`) shared across all sub-accounts,
  same model as `FIRECRAWL_API_KEY` / `GITPAGE_API_KEY`. No embedded secrets.
- **Disables cleanly when unset.** `vibeTradingIsConfigured()` gates every route;
  missing key → `503` + friendly UI message. The rest of uGotLeads is unaffected.
- **The Vibe service is stateless per request** from our side — we send the prompt
  + risk profile + config, it returns (or streams) research/backtest output, we
  persist to Firestore. Vibe's own laptop-workspace persistence is not used; our
  Firestore is the system of record for tenancy + audit.
- **Hosting the Python service is Star's infra step** (a Docker deploy on
  Fly.io/Railway with the market-data + LLM provider keys Vibe needs). It is not
  a Vercel concern and is called out in the manual-steps section.

### Why async + QStash (not a synchronous call)

Backtests, Monte Carlo, and multi-agent swarm research are slow (seconds to
minutes) and bursty. We reuse the **exact gitpage build/poll pattern** already in
the repo:

1. `POST /api/sub-accounts/[id]/trading/run` → submit job to Vibe, persist
   `tradingRuns/{runId}` with `status: "queued"` + the Vibe job id, schedule the
   first QStash poll.
2. `POST /api/sub-accounts/[id]/trading/poll` (QStash signature-verified) → hit
   Vibe's status endpoint, mirror result into Firestore, reschedule until terminal
   or a hard cap (mirror `MAX_POLL_ATTEMPTS`).
3. UI subscribes to `tradingRuns/{runId}` via `onSnapshot` and streams status
   queued → running → done/failed live — same as the website-builder banner.

---

## 4. Data model (Firestore)

All docs carry tenancy keys per CLAUDE.md: `agencyId`, `subAccountId`,
`createdByUid`. **Multi-tenant isolation is a hard invariant** — every query
scoped to `{ agencyId, subAccountId }`, never cross-tenant.

### `subAccounts/{id}/tradingAgent/profile` (singleton)

Mirrors `aiAgent/profile`. Written server-side only.

| Field | Type | Notes |
|---|---|---|
| `riskLevel` | `"conservative" \| "moderate" \| "aggressive"` | Drives strategy constraints sent to Vibe |
| `allowedAssetClasses` | `("stocks" \| "crypto" \| "forex")[]` | Which of Vibe's markets are enabled |
| `strategyPreferences` | `string` | Free-text persona/constraints for the swarm |
| `dataSourceKeys` | `string[]` | Which of Vibe's 18+ sources to allow (no secrets stored here) |
| `defaultBacktestWindow` | `{ startDate, endDate }` | Default range for backtests |
| `disclaimerAcceptedAt` | `Timestamp \| null` | Client acknowledged the not-advice disclaimer |
| `mode` | `"paper" \| "research_only"` | **Phase A is locked to these two. No `"live"`.** |

### `subAccounts/{id}/tradingRuns/{runId}` (one per job)

| Field | Type | Notes |
|---|---|---|
| `prompt` | `string` | Natural-language request ("backtest a mean-reversion strategy on...") |
| `runType` | `"research" \| "strategy" \| "backtest" \| "risk" \| "monte_carlo"` | |
| `vibeJobId` | `string \| null` | Vibe service's job handle for polling |
| `status` | `"queued" \| "running" \| "done" \| "failed"` | onSnapshot-driven UI |
| `result` | `object \| null` | Structured output: metrics, equity curve, MC distribution, risk stats |
| `resultSummaryMd` | `string \| null` | Human-readable markdown summary (capped, like the KB snapshot) |
| `error` | `string \| null` | Populated on failure |
| `pollAttempts` | `number` | Cap enforcement |
| `createdAt` / `updatedAt` | `Timestamp` | |

Optional subcollection `tradingRuns/{runId}/artifacts/{id}` for large exports
(CSV/JSON) if we let clients download backtest data — deferred unless needed.

### Activity + audit

Each terminal run writes a typed `activities` row on the linked contact/account
(audit-only), and every agent run is logged. Audit logging is a **compliance
feature**, not optional.

---

## 5. Firestore rules

New blocks under `match /subAccounts/{subAccountId}` mirroring the existing
`aiAgent/*` block: **members read, server-only write.**

```
// Trading OS — risk profile + per-run results. Profile at
// tradingAgent/profile; each job at tradingRuns/{runId}. Members can
// read so the workspace hydrates + streams live via onSnapshot. All
// writes go through /api/sub-accounts/[id]/trading/* (Admin SDK) so the
// server validates the risk profile, enforces mode != "live" in Phase A,
// and stamps tenancy + disclaimers before persisting.
match /tradingAgent/{docId} {
  allow read: if canAccessSub(
    subAccountId,
    get(/databases/$(database)/documents/subAccounts/$(subAccountId)).data.agencyId
  );
  allow write: if false;
}
match /tradingRuns/{runId} {
  allow read: if canAccessSub(
    subAccountId,
    get(/databases/$(database)/documents/subAccounts/$(subAccountId)).data.agencyId
  );
  allow write: if false;
  match /artifacts/{artifactId} {
    allow read: if canAccessSub(
      subAccountId,
      get(/databases/$(database)/documents/subAccounts/$(subAccountId)).data.agencyId
    );
    allow write: if false;
  }
}
```

> **Callout (per multi-tenant boundary rule):** this change touches
> `firestore.rules`. It must be deployed separately with
> `firebase deploy --only firestore:rules` — it is NOT auto-deployed with Vercel.

---

## 6. Server code

### `src/lib/vibe-trading/client.ts` (`import "server-only"`)

Mirrors `lib/firecrawl/client.ts` + `lib/gitpage/client.ts`:

- `vibeTradingIsConfigured(): boolean` — checks `VIBE_TRADING_API_KEY`.
- `class VibeTradingError extends Error { status: number }`.
- `submitRun(input): Promise<{ vibeJobId, pollIntervalSeconds }>` — POST to Vibe's
  generate/research endpoint with Bearer auth, risk profile, prompt, config.
- `pollRun(vibeJobId): Promise<{ status, result, resultSummaryMd, error, isTerminal }>`.
- Timeouts via `AbortSignal.timeout()`, non-2xx → `VibeTradingError` mapped to a
  friendly status by the route (503/502/429), same as the existing wrappers.
- **Server-side guard:** reject/normalize any request where `mode === "live"` in
  Phase A. Live mode is not constructible from the Phase A UI, but the server
  enforces it too (defense in depth).

### API routes (Admin SDK, tenant-scoped server-side)

| Route | Method | Purpose |
|---|---|---|
| `/api/sub-accounts/[id]/trading/profile` | `GET`/`PATCH` | Read/write risk profile. Validates enum values, enforces `mode`. |
| `/api/sub-accounts/[id]/trading/run` | `POST` | Submit a run; create `tradingRuns/{runId}`; schedule first poll. |
| `/api/sub-accounts/[id]/trading/poll` | `POST` | QStash callback; verify signature; mirror Vibe status → Firestore; reschedule/terminate. In `PUBLIC_PATH_PATTERNS` (security = signature, not cookie). |
| `/api/sub-accounts/[id]/trading/run/[runId]` | `DELETE` | Cancel/reset a run. Admin-only. |

Every route: `requireUid()` + tenant guard, exactly like the AI-agent routes.

### Gating (Phase A posture)

Following the **Voice module's Posture-B precedent** (owner/admin gate until a
dependency ships): in Phase A, **submitting a run is available to all sub-account
members** (it's just research), **but** the risk-profile `mode` can never be
`"live"` and there is no execution route at all. When Phase B is scoped, execution
gets its own owner/admin + agency-allowlist gate (`SubAccountDoc` flag, defaulting
to `false`, like `outboundVoiceEnabledByAgency`).

---

## 7. UI surfaces

New route group `/sa/[subAccountId]/trading/`, reusing existing patterns:

- **`/trading` (Overview)** — risk-profile form (sectioned form like the website
  builder), a "New research run" composer (natural-language box like the AI test
  panel), and a live run history list (onSnapshot, like broadcasts detail).
- **`/trading/runs/[runId]`** — run detail: status header, the strategy, backtest
  metrics, an inline SVG equity curve (reuse `components/reports/` SVG primitives —
  no chart library), Monte Carlo distribution, risk report. Markdown summary.
- **Persistent disclaimer banner** on every trading surface (component in
  `components/trading/`), non-dismissible.
- Sidebar entry gated on the module being enabled for the sub-account.

All UI: loading + error states handled, `"use client"` Firestore subscriptions
unsubscribed on unmount (code-engineer SOUL rules).

---

## 8. Environment variables

Add to `.env.example` + Vercel (Star's manual step):

| Var | Required? | Source |
|---|---|---|
| `VIBE_TRADING_API_URL` | Phase A | The deployed Vibe Trading service base URL |
| `VIBE_TRADING_API_KEY` | Phase A | Agency-level key for the Vibe service |

Vibe's own provider keys (market data, LLM providers, brokers) live **on the Vibe
service**, not in uGotLeads — same separation as gitpage's internal keys. Without
`VIBE_TRADING_API_KEY`, the module disables cleanly (503 + friendly message).

---

## 9. Phasing & milestones

### Phase A — Research/strategy workspace (revenue product)

| Week | Deliverable |
|---|---|
| 1 | Stand up Vibe service (Docker); `lib/vibe-trading/client.ts`; one `run` + `poll` round-trip proven for a single sub-account (backtest → Firestore). |
| 2 | Risk-profile data model + rules + `profile` route; deploy rules. |
| 3 | Run composer UI + run history (onSnapshot); disclaimer banner. |
| 4 | Run-detail UI: metrics, SVG equity curve, Monte Carlo, risk report. |
| 5 | Audit logging, `mode` enforcement hardening, empty/error/not-configured states. |
| 6 | Package + price as a module add-on; compliance-reviewer pass on all copy. |

### Phase B — Discretionary / managed money (lawyer-gated, separate track)

**Not an engineering milestone.** Requirements to hand a securities attorney:

- Entity structure (RIA vs private fund vs both), custody arrangement, broker-dealer
  relationship, accredited-investor gating, Form ADV, client agreements,
  fiduciary/disclosure obligations, state vs SEC registration thresholds.
- Only after counsel sign-off do we scope: live broker execution, discretionary
  mandates, per-client account linking, execution gating + audit, kill-switch.

---

## 10. Pricing (founder-operator lens)

Every change must serve the tokenmaxxing bucket. Phase A is **new recurring
revenue** with clean margin (per-run compute is the only variable cost, and Vibe's
default models are cheap). Suggested: a **module add-on** on top of existing tiers,
or a new **"Wealth/Trading OS" tier** above Territory Partner ($497/mo). Exact
number is a separate pricing decision — flag for a dedicated pass. Do not attach
any return/income numbers to the pricing without the earnings disclaimer.

---

## 11. Decisions — status

1. **Vibe hosting** — ✅ **Railway** (see "Decisions locked" up top).
2. **Broker connections** — ✅ **paper now + self-directed live later** (see above).
3. **Pricing** — ⏳ still open. Recommend a module add-on or a new "Trading/Wealth OS"
   tier above Territory Partner ($497/mo). No return/income numbers without the
   earnings disclaimer.
4. **Phase B lawyer brief** — ⏳ open. Say the word and I'll draft the requirements
   doc to hand securities counsel (no code).

---

## 12. Definition of done for this doc

- **What changed & why:** added this module spec; no runtime code touched.
- **How to test locally:** N/A (planning doc).
- **Surfaces/stubs touched:** none yet. Phase A will touch `firestore.rules`
  (multi-tenant callout), add `lib/vibe-trading/*`, new API routes, new
  `/sa/[id]/trading/*` UI, and `.env.example`.
- **Star's manual steps (when Phase A builds):** deploy the Vibe service + its
  provider keys; add `VIBE_TRADING_API_URL` + `VIBE_TRADING_API_KEY` to Vercel;
  run `firebase deploy --only firestore:rules`; push to main; compliance pass on
  copy; the Phase B lawyer engagement.
