# MLM Package Sandbox Review (Perl / Genelet candidate)

> **Status:** Review document only (Phase 24D). The package has **not** been
> installed, cloned, connected, or run. No uGotLeads code changed. No API
> connected. This document evaluates a Perl/Genelet-style MLM package as a
> *future sandbox candidate* and gives a go/no-go for a **sandbox install only**.
>
> **Compliance note:** Nothing here authorizes rank, genealogy, downline,
> binary, unilevel, team-volume, or compensation-plan logic inside uGotLeads
> core. Any MLM engine lives entirely outside core, behind the one-way event
> outbox (Phase 24B), and only after legal review (Phase 24G).

---

## 0. Context & how this fits

Phase 24A established the integration architecture; Phase 24B built the
append-only `partner_network_events` outbox (flag-gated, dormant); Phase 24C
added the read-only export/report layer. This review (24D) assesses whether a
specific class of off-the-shelf MLM engine — a Perl/Genelet package providing
genealogy + compensation + payouts — is a viable **sandbox** consumer of those
exports.

**This review is based on the general capability profile of Perl/Genelet-style
MLM packages.** Before any sandbox install, the exact package + version + license
must be pinned and re-reviewed against this document (see §8 next steps).

---

## 1. What this class of package typically provides

| Capability | Typical in package? | Notes |
|---|---|---|
| Genealogy / downline tree | Yes | Sponsor/placement tree, upline traversal. **MLM-owned only.** |
| Unilevel compensation | Yes | Level-based payout depth (e.g. pay N levels up). |
| Team / pairing / binary | Often | Binary leg balancing, pairing bonuses. **Not needed for MyUSA v1.** |
| Affiliate / referral compensation | Yes | Flat referral commissions — overlaps with uGotLeads' existing FLAT `commission_events`. |
| Ledger | Yes | Internal earnings ledger per partner. **MLM-owned store.** |
| Payouts / payout batches | Yes | Batch run, payable balances, payout export. |
| Cron jobs | Yes | Scheduled commission runs, rank recalcs, payout cycles. Operational burden. |
| JSON API | Sometimes | Quality varies; auth model often weak/custom. |
| Admin panel | Yes | Web admin (often Perl-templated); separate auth from uGotLeads. |
| Automated tests | Rarely comprehensive | Coverage typically thin; treat as untrusted until verified. |
| Setup / deployment | Heavyweight | Perl runtime + MySQL + cron + web server. Not Vercel/Firestore-native. |

**Bottom line:** it is a full vertical MLM stack (data model + math + payouts +
admin), not a library. That is exactly why it must run as a **separate service
with its own database**, never embedded in uGotLeads.

---

## 2. Comparison to MyUSA needs

| MyUSA need | Package fit | Gap / concern |
|---|---|---|
| **Product-sales-centered compensation** | Partial | Package is genealogy/recruiting-centered by default. MyUSA must drive comp from **product sales events**, not enrollment. Requires adapter to feed only sale-backed events. |
| **Certified AI Consultant track** | None | No concept of certification gating. uGotLeads owns this (`track_progress`); adapter would pass `partner.certified` as eligibility input. |
| **Support Local Community Advocate track** | None | Same — certification-driven eligibility is a MyUSA concept layered on top. |
| **Local business referrals** | Partial | Referral comp exists, but uGotLeads already records flat referral commissions; avoid double-counting. |
| **Education sales** | Via product events | Maps cleanly as `marketplace.purchase.paid` with `productFamily=myusa_education`. |
| **Software subscriptions** | Via subscription events | Needs `subscription.renewed` / `subscription.canceled` (not yet wired in 24B). Recurring comp + clawback on cancel is complex. |
| **Services / resources / media products** | Via product events | Map by `productFamily`; no special package support needed. |
| **Compliance-first messaging** | Poor | These packages lean recruiting-first in UI/terminology. MyUSA must keep **product sale at the center** and suppress recruiting-first framing. Big mismatch to manage. |

**Key tension:** the package's native worldview is *recruit → build downline →
earn on team volume*. MyUSA's required worldview is *sell products → earn on
real sales → certification gates who can sell what*. The adapter must translate
**sale-first** events into the package's model and **must not** enable
recruiting-first comp paths.

---

## 3. Recommended integration approach (if it ever proceeds)

Non-negotiable boundaries, consistent with Phase 24A:

1. **Sandbox only** for now — isolated environment, synthetic data, no
   connection to uGotLeads.
2. **Separate service** — runs on its own host/runtime (Perl), never inside the
   Next.js/Vercel app.
3. **Separate database** — its own MySQL instance. uGotLeads stays on Firestore.
   No shared DB, no cross-DB writes.
4. **No Firebase Admin SDK access** — the MLM service gets **zero** credentials
   for the uGotLeads Firebase project. It physically cannot write to core.
5. **Consume outbox exports only** — input is the `partner_network_events`
   feed (24B/24C exports, later a controlled pull). One-way.
6. **Never write to uGotLeads core collections** — `product_entitlements`,
   `marketplace_purchases`, `credit_wallets`, `byok_keys`, `product_eligibility`,
   `commission_events`, `partner_profiles`, customer workspaces. Any state
   uGotLeads needs reflected goes through an existing owner-gated core route,
   triggered by a human/recon job — never by the MLM service directly.

```
partner_network_events (uGotLeads, Firestore, source of truth)
   → export / controlled pull (one-way)
       → [Adapter]  (maps sale-first events → MLM inputs)
           → MLM engine (Perl + MySQL, separate service, separate DB)
               → MLM-owned ledger + payout batches
                   → Partner dashboard + reconciliation (read-only vs core)
```

---

## 4. Technical risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Perl/Genelet maintenance** | High | Aging ecosystem, scarce maintainers. Pin version; budget for in-house Perl ownership or wrap behind a stable API and treat as replaceable. |
| **MySQL dependency** | Medium | New datastore alongside Firestore. Separate ops, backups, scaling. Acceptable only as an isolated MLM-owned DB. |
| **Auth / SSO gap** | High | Package admin uses its own auth, not Firebase sessions. Risk of a second, weaker identity system. Keep admin internal-only; do not expose to partners directly until SSO bridged. |
| **Payout compliance** | High | Real money movement. Tax forms, KYC, jurisdiction rules — all outside current scope. Must not go live without legal + finance sign-off. |
| **API security** | High | These packages often ship weak/custom API auth. Place behind a hardened gateway; never expose the MLM API publicly; mTLS or signed requests from the adapter only. |
| **Event → MLM record mapping** | Medium | uGotLeads events are sale-first + flat; package expects genealogy + volume. Mapping is non-trivial and must avoid double-counting flat commissions already in core. |
| **Data privacy (PII)** | High | Genealogy + payout data is sensitive PII. Separate DB needs its own retention, encryption, access controls, and data-processing agreement. |
| **Reconciliation complexity** | Medium | Two ledgers (core flat commissions vs MLM multi-level). Need a reconciliation view (Phase 24F) to detect drift, refunds, clawbacks. |
| **Idempotency / replay** | Medium | Adapter must dedupe on `eventId`; package runs (cron) must be idempotent or guarded to avoid duplicate payouts. |

---

## 5. Compliance risks

| Risk | Severity | Required control |
|---|---|---|
| **Recruiting-first appearance** | Critical | Package defaults read recruiting-first. MyUSA must keep **customer product sales** as the basis of all compensation. Disable/avoid any recruit-to-earn path. |
| **Income claims** | Critical | No earnings guarantees anywhere. Standard disclaimer required: "Results are not guaranteed. Individual earnings depend on effort, market conditions, and execution." |
| **Franchise language** | High | No "franchise" / territorial-guarantee language. MyUSA is a software license + resource-access program. |
| **Business-opportunity / FTC rule exposure** | Critical | Multi-level + payouts can trigger business-opportunity and FTC scrutiny. Legal review mandatory before any production wiring. |
| **Customer-sale requirement** | Critical | Compensation must trace to a real product sale (`marketplace.purchase.paid`), not enrollment fees or recruiting. This is the single most important guardrail. |
| **Refund & clawback policy** | High | Refund/chargeback after a paid multi-level bonus → clawback rules needed. `refund.created` / `chargeback.created` events (not yet wired) must drive reversals. |
| **State-specific review** | High | GA, AZ, TN initial markets each need review; MLM/anti-pyramid statutes vary. |
| **Pay-for-recruiting** | Critical | Explicitly prohibited. No bonus may attach to the act of recruiting a partner. |

---

## 6. Go / No-Go recommendation

| Decision | Recommendation | Rationale |
|---|---|---|
| **Sandbox install** | **CONDITIONAL YES** | Permitted **only** in a fully isolated sandbox with synthetic data, separate host, separate MySQL, **no** Firebase credentials, **no** connection to uGotLeads, **no** real PII or money. Purpose: evaluate data model, API quality, and mapping feasibility. Must pin exact package + version + license first. |
| **Production integration** | **NO** | Not until Phase 24G legal/compliance review explicitly approves genealogy, income disclosures, refund/clawback policy, and state-by-state posture. Hard gate. |
| **Embedding into uGotLeads core** | **NEVER** | The package never runs inside the Next.js app, never shares the Firestore DB, never gets Admin SDK credentials. |

**Sandbox guardrails (if 24D sandbox proceeds):**
- Synthetic/fixture data only — zero real customer/partner PII.
- No outbound network from the sandbox to production.
- No real payment rails connected.
- Time-boxed evaluation; tear down after assessment.
- Document findings against §1–§5 with the *actual* pinned package.

---

## 7. What this phase explicitly did NOT do

- Did **not** install, clone, download, or run the package.
- Did **not** connect any API or external system.
- Did **not** add MLM logic or any rank/genealogy/downline/binary/unilevel/
  team-volume/payout-tree/override/compensation-plan code.
- Did **not** change uGotLeads code, checkout, Stripe, commission math,
  entitlements, credits, BYOK, or partner eligibility.

---

## 8. Recommended next safe phase after this review

1. **Pin the exact package** (name, version, license) and re-validate §1–§5
   against the real source — this review is capability-profile-based and must be
   confirmed against the actual artifact.
2. If go: **Phase 24D-sandbox** — isolated, synthetic-data evaluation per §6
   guardrails. Output: a findings addendum to this doc.
3. **Phase 24E (adapter prototype)** — only against exported/synthetic events,
   read-only, in the sandbox. Validate the sale-first → MLM mapping.
4. **Phase 24F (reconciliation dashboard)** — compare core flat commissions ↔
   MLM payout results; detect drift before any real run.
5. **Phase 24G (legal/compliance review)** — **hard gate** before any production
   wiring.
6. **Phase 24H (production integration)** — only after 24G, with monitoring +
   kill switch, no MLM write-back to core.

**Recommendation:** proceed to pin-and-reconfirm (step 1) before authorizing
even the sandbox install. Do not skip to 24E/24H. Loop in legal early given the
GA/AZ/TN business-opportunity exposure.
