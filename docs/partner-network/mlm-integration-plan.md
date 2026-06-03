# MyUSA Partner Network / MLM Integration Plan

> **Status:** Architecture plan only (Phase 24A). No integration code, no MLM
> package installed, no changes to checkout, Stripe, commission math, or
> entitlement logic. This document defines how a *future* MyUSA Partner Network
> or multi-level compensation engine could connect to uGotLeads **without
> polluting uGotLeads core**.
>
> **Compliance note:** Nothing in this document authorizes rank, genealogy,
> downline, binary, unilevel, team-volume, or compensation-plan logic inside
> uGotLeads. Those concerns live entirely outside the core, behind a one-way
> event bridge, and only after legal/compliance sign-off (Phase 24G).

---

## 0. Guiding principle

**uGotLeads is a product-sales platform. The customer product sale is the
center of gravity — always.**

The MLM / Partner Network engine is a *downstream consumer* of approved events.
It never reaches back into uGotLeads core data. It receives flat, factual events
("a paid purchase happened", "a flat commission event was created") and returns
*calculated* results (bonus amounts, payout batches) that live in **its own**
storage and surfaces — never overwriting uGotLeads records.

If the MLM engine were deleted tomorrow, uGotLeads would continue to function
unchanged: products sell, customers get access, flat commissions accrue.

---

## 1. Current uGotLeads source-of-truth map

These collections are owned by uGotLeads core. They are the **authoritative**
record. The MLM engine may *read exports* of them (via the bridge) but must
**never write** to them.

| Domain | Collection(s) | Owner | Key | Write path today |
|---|---|---|---|---|
| Products | `products/{id}` | uGotLeads | agency-scoped | Agency owner (Product Manager) |
| Customers | Firebase Auth users + `users/{uid}`, sub-account memberships | uGotLeads | uid | Signup / membership routes |
| Partners | `partner_profiles/{uid}` | uGotLeads | uid === partnerProfileId | Agency owner (Partner Manager) |
| Purchases | `marketplace_purchases/{sessionId}` | uGotLeads | Stripe session id | Stripe webhook (Admin SDK) |
| Entitlements (customer access) | `product_entitlements/{customerUserId}_{productId}` | uGotLeads | customer+product | Fulfillment hook + repair route (Admin SDK) |
| Product eligibility (partner SELL rights) | `product_eligibility/{partnerProfileId}_{productId}` | uGotLeads | partner+product | Agency owner (Eligibility Manager) |
| Commissions (flat, single-level) | `commission_events/{id}`, `commission_rules/{id}` | uGotLeads | auto / rule | Webhook via `createCommissionEventForPayment` (gated by `PARTNER_COMMISSIONS_ENABLED`) |
| Credit wallets | `credit_wallets/{partnerProfileId}`, `credit_transactions/{id}` | uGotLeads | partnerProfileId | `serverApplyCreditDelta` / `spendCredits` (Admin SDK) |
| Subscriptions | `subAccounts/{id}` plan state + Stripe subscription | uGotLeads | sub-account | Stripe webhook |
| BYOK keys | `byok_keys/{partnerProfileId}_{productId}` (AES-256-GCM) | uGotLeads | partner+product | BYOK setup route (Admin SDK, encrypted) |
| Certifications / tracks | `partner_tracks`, `certifications`, `track_progress` | uGotLeads | various | Training flow + agency approval |

**Commission scope today:** `commission_events` is **flat / single-level** — one
partner, one sale, one percentage from a `commission_rule`. There is **no**
multi-level math, no upline crediting, no team volume. This is intentional and
must not change inside core.

---

## 2. Future MyUSA Partner Network responsibilities

All of the following live **outside** uGotLeads core, in a separate service /
package / datastore. They are listed here only to define the boundary — none are
authorized for implementation until Phase 24G legal review.

| Responsibility | Lives in | Notes |
|---|---|---|
| Rank logic | MLM engine | If ever used. Derived from consumed events, never stored in core. |
| Team / genealogy structure | MLM engine | Only if legally approved. Upline/downline graph is MLM-owned. |
| Multi-level compensation calculations | MLM engine | Consumes flat `commission.event.created` + purchase events; computes level payouts in its own tables. |
| Payout batches | MLM engine | Batch runs, payout ledgers, tax docs — MLM-owned. |
| Partner enrollment structure (sponsorship tree) | MLM engine | uGotLeads stores a flat `partner_profiles`; any sponsor/placement tree is MLM-owned. |
| Compliance controls | MLM engine + legal | Earnings disclaimers, income disclosures, jurisdiction gating. |
| Income disclosure controls | MLM engine + legal | Statement generation, "results not guaranteed" enforcement. |

**uGotLeads never computes or displays** rank, downline earnings, team volume,
or projected income. If the Partner Network wants to *show* a partner their MLM
standing, that is rendered by an MLM-owned surface (or a clearly-separated
read-only panel fed by the MLM engine), not by uGotLeads core pages.

---

## 3. Clear separation of concerns

```
┌─────────────────────────────────────────────────────────────┐
│ uGotLeads CORE (authoritative)                               │
│                                                              │
│  • Product catalog + checkout (Stripe)                       │
│  • Customer records + workspaces                             │
│  • Product entitlements (customer access)                    │
│  • Product eligibility (partner sell rights)                 │
│  • Credit wallets + transactions                             │
│  • BYOK keys (encrypted)                                     │
│  • FLAT commission events (single-level only)                │
│                                                              │
│  Emits factual events ───────────────┐                      │
└──────────────────────────────────────┼──────────────────────┘
                                        │  (one-way, append-only)
                                        ▼
                          ┌──────────────────────────┐
                          │ EVENT BRIDGE / OUTBOX     │  (Phase 24B)
                          │ append-only, signed,      │
                          │ uGotLeads-owned           │
                          └────────────┬─────────────┘
                                       │ pulled / pushed
                                       ▼
                          ┌──────────────────────────┐
                          │ MyUSA Partner Network     │  (external)
                          │ ADAPTER (Phase 24E)       │
                          │ translates core events →  │
                          │ MLM engine inputs         │
                          └────────────┬─────────────┘
                                       ▼
                          ┌──────────────────────────┐
                          │ MLM ENGINE / API          │  (external)
                          │ rank, genealogy, multi-   │
                          │ level payout math         │
                          │ → MLM-owned storage only  │
                          └────────────┬─────────────┘
                                       │ payout results (read-only back)
                                       ▼
                          ┌──────────────────────────┐
                          │ Partner Network dashboard │
                          │ + admin audit / recon     │  (Phase 24F)
                          └──────────────────────────┘
```

**Direction of authority:**
- Core → bridge → MLM: **factual events only** (what happened).
- MLM → dashboard/audit: **calculated results only** (bonuses, payouts).
- MLM → core: **nothing.** No write-back path exists or is authorized.

---

## 4. Event bridge design — proposed event types

Events are **factual, past-tense, immutable**. They describe something that
already happened in core. They carry **no** MLM semantics (no rank, no level, no
upline). The MLM engine derives all of that itself.

Proposed envelope (shape only — not implemented this phase):

```jsonc
{
  "eventId": "evt_<uuid>",            // unique, idempotency key for consumers
  "type": "marketplace.purchase.paid",
  "agencyId": "<agencyId>",
  "occurredAt": "2026-06-03T00:00:00Z",
  "version": 1,
  "source": "ugotleads-core",
  "data": { /* type-specific, see below */ },
  "signature": "<hmac>"               // bridge-signed; consumers verify
}
```

| Event type | Fired when | Core source | Key `data` fields (factual only) |
|---|---|---|---|
| `partner.created` | partner_profile created | Partner Manager | partnerProfileId, tier, status, referralCode |
| `partner.certified` | track approved → completedTrackIds updated | Certifications admin | partnerProfileId, trackId, certifiedAt |
| `product.purchased` | checkout session created | checkout route | sessionId, productId, customerUserId, amountCents |
| `marketplace.purchase.paid` | webhook confirms payment | Stripe webhook | sessionId, productId, customerUserId, amountCents, referredByPartnerProfileId, partnerReferralCode |
| `entitlement.granted` | fulfillment hook / repair | fulfillment | entitlementId, customerUserId, productId, source |
| `commission.event.created` | flat commission written | commission writer | commissionEventId, partnerProfileId, commissionCents, commissionPct, productId |
| `commission.event.paid` | flat commission marked paid | commissions admin | commissionEventId, partnerProfileId, paidOutAt |
| `refund.created` | refund recorded (future) | refund handler | sessionId, amountCents, reason |
| `chargeback.created` | dispute recorded (future) | Stripe dispute webhook | sessionId, amountCents |
| `subscription.renewed` | renewal webhook (future) | Stripe webhook | subAccountId, productId, periodEnd |
| `subscription.canceled` | cancellation webhook (future) | Stripe webhook | subAccountId, productId, canceledAt |
| `credit.purchase.created` | credit top-up purchase | credit purchase flow | partnerProfileId, credits, amountCents |

**Design rules for events:**
1. **Idempotent** — every event has a stable `eventId`; consumers dedupe on it.
2. **Append-only** — events are never mutated or deleted after emission.
3. **No MLM fields** — events never carry rank, level, upline, team volume.
4. **Reversal over edit** — corrections emit a new compensating event
   (`refund.created`, `chargeback.created`), never an edit of a prior event.
5. **Signed** — the bridge HMAC-signs each event; the adapter verifies before
   handing to the MLM engine.

---

## 5. Adapter design

The adapter is the **only** component that knows both vocabularies. It is owned
by the MyUSA Partner Network side, not uGotLeads core.

```
uGotLeads event (factual)
   → [Adapter] verify signature → map to MLM input schema → enqueue
       → MLM engine / API computes rank + multi-level payout
           → MLM-owned result store
               → [Adapter] → Partner Network dashboard + admin audit / reconciliation
```

**Adapter responsibilities:**
- Verify event signature + dedupe by `eventId`.
- Translate core event → MLM engine input (this is where any
  upline/genealogy lookup happens — in MLM territory, using MLM data).
- Call the MLM engine/API; persist the **calculated result** in MLM storage.
- Surface results to the Partner Network dashboard and an **admin
  reconciliation** view that compares: flat commission events in core ↔ payout
  results in MLM, flagging mismatches.

**Adapter must NOT:**
- Write to any uGotLeads core collection (see §6).
- Re-emit events back into core.
- Block or delay core checkout/fulfillment (fully async, consumes from outbox).

---

## 6. Data safety — hard write boundaries

The MLM package / adapter / engine must **never** directly write to:

- `product_entitlements`
- `marketplace_purchases`
- `credit_wallets` / `credit_transactions`
- `byok_keys`
- `product_eligibility`
- customer workspaces (`contacts`, `deals`, `subAccounts/*`, etc.)
- `commission_events` / `commission_rules` (core owns flat commissions)
- `partner_profiles`

**Enforcement mechanisms (when integration is built):**
1. The MLM engine runs as a **separate service** with **no Admin SDK
   credentials** for the uGotLeads Firebase project.
2. The only shared surface is the **event outbox** (read access) and a separate
   MLM result store (MLM write access).
3. Firestore rules already deny all client writes to the sensitive collections;
   server writes are confined to existing uGotLeads core routes.
4. Any "payout applied" state the MLM engine wants reflected in uGotLeads (e.g.
   marking a flat `commission_event` paid) goes through an **existing
   owner-gated core route**, triggered by a human or a core-side reconciliation
   job — never by a direct MLM write.

---

## 7. Compliance boundaries (non-negotiable)

Until Phase 24G legal/compliance review explicitly approves otherwise:

- **No** rank, genealogy, downline, binary, unilevel, team-volume, or
  compensation-plan code in uGotLeads core.
- **No earnings-guarantee language** anywhere in core UI or copy.
- **No franchise language** ("franchise", "territory guarantee", etc.) in core.
- **No "pay for recruiting" logic** — commissions in core are tied to **product
  sales**, never to enrolling other partners.
- **Customer product sales remain the center.** Partner economics are a
  downstream consequence of real product sales, computed externally.
- Income/earnings claims, when they eventually exist, are MLM-engine-owned and
  must carry the standard disclaimer ("Results are not guaranteed. Individual
  earnings depend on effort, market conditions, and execution.") per the MyUSA
  CLAUDE.md standard disclosures.

---

## 8. Recommended phased roadmap

Safest path, each phase shippable and reversible on its own:

| Phase | Deliverable | Touches core? | Risk |
|---|---|---|---|
| **24A** | This architecture document | No (docs only) | None |
| **24B** | Event **outbox** table — append-only `partner_network_events` collection, written best-effort alongside existing core writes (behind a flag, default off). No consumer yet. | Additive only (new collection + server-only rule) | Low — purely additive, flag-gated |
| **24C** | Export / admin report — owner-only read view of the outbox + a CSV/JSON export for manual hand-off to the Partner Network team | No core mutation | Low |
| **24D** | MLM package **sandbox** — install/evaluate the MLM engine in an isolated environment with **synthetic** data only. No connection to core. | No | Low (isolated) |
| **24E** | Adapter **prototype** — consumes a copy/export of outbox events in the sandbox, produces sample payout calculations. Read-only against exported data. | No | Medium (validate mapping) |
| **24F** | Reconciliation dashboard — compares core flat commissions ↔ MLM payout results, flags drift. Read-only on both sides. | No core mutation | Medium |
| **24G** | Legal / compliance review — sign-off on rank/genealogy/income-disclosure before ANY production wiring. **Gate.** | No | — (governance gate) |
| **24H** | Production integration — live outbox → adapter → MLM engine, with monitoring + kill switch. Only after 24G approval. | Outbox emit becomes live (still additive); no MLM write-back to core | High — requires monitoring, kill switch, staged rollout |

**Sequencing rules:**
- 24B–24F can proceed without touching checkout, Stripe, commission math, or
  entitlement logic.
- 24G is a **hard gate**: no production MLM wiring (24H) before legal sign-off.
- A **kill switch** (single flag) must disable outbox emission instantly at 24H
  without affecting core sales/fulfillment.

---

## 9. Open questions for legal / product (pre-24G)

1. Is a genealogy/sponsorship tree legally permissible in target states
   (GA, AZ, TN initial markets)?
2. Required income-disclosure cadence + format per jurisdiction?
3. Does any partner economic benefit ever attach to *recruiting* vs. *product
   sales*? (Core stance: product sales only.)
4. Refund / chargeback clawback policy on already-paid multi-level bonuses?
5. Data-retention + PII handling for partner genealogy in the MLM store?

---

## 10. What this phase explicitly did NOT do

- Did **not** install the Perl MLM package or any MLM dependency.
- Did **not** create the outbox table (that is Phase 24B).
- Did **not** change checkout, Stripe, commission math, or entitlement logic.
- Did **not** add rank, genealogy, downline, binary, unilevel, team-volume, or
  compensation-plan code anywhere.
- Did **not** add earnings-guarantee, franchise, or pay-for-recruiting language.

This is a planning artifact only. Implementation begins at Phase 24B and remains
gated by Phase 24G legal review before any production integration.
