# uGotLeads Revenue OS — v1 Launch QA & Production Readiness Runbook

> **Purpose:** End-to-end QA checklist + launch runbook for the current Revenue
> OS build. Work top to bottom. Do not flip any production flag until every
> **No-Go blocker** in §7 is clear.
>
> **Scope note:** This is a release runbook only. No new features, no MLM
> integration, no changes to checkout/Stripe/commission/entitlement/credit/BYOK/
> partner logic. The Partner Network outbox stays **dormant** (flag off) for v1.

---

## 0. Safety posture (read first)

uGotLeads ships **safe-by-default**. Every revenue-activating capability is
behind an env flag that is **off** unless explicitly set:

| Capability | Flag | v1 production default |
|---|---|---|
| Marketplace checkout | `MARKETPLACE_CHECKOUT_ENABLED` | **off** |
| Partner commissions | `PARTNER_COMMISSIONS_ENABLED` | **off** |
| Partner network event outbox | `PARTNER_NETWORK_EVENTS_ENABLED` | **off** |
| BYOK key storage | `BYOK_KEY_ENCRYPTION_SECRET` | set only if BYOK products used |

Dev-only routes (`/api/dev-only/*`) are blocked in production unless
`REVENUE_OS_SEED_ALLOW_PRODUCTION=true` — **never set this in production.**

---

## 1. Pre-flight: deploy + environment

### 1.1 Firestore rules deploy
- [ ] `firebase deploy --only firestore:rules` run against the correct project.
- [ ] Rules include the Revenue OS + partner-network collections:
      `partner_profiles`, `partner_tracks`, `certifications`, `products`,
      `product_eligibility`, `product_entitlements`, `partner_referrals`,
      `commission_rules`, `commission_events`, `credit_wallets`,
      `credit_transactions`, `track_progress`, `byok_keys`,
      `partner_network_events`.
- [ ] Spot-check: open each owner-only admin page; **no** Firestore
      permission-denied errors in the browser console.

### 1.2 Firestore indexes deploy
- [ ] `firebase deploy --only firestore:indexes` run.
- [ ] Composite indexes present and **Enabled** (not Building) in Firebase
      console for: `marketplace_purchases` (subAccountId+createdAt,
      referredByPartnerProfileId+createdAt, agencyId+createdAt),
      `commission_events` (agencyId+createdAt), `commission_rules`
      (agencyId+isActive), `products` (agencyId+productFamily),
      `credit_transactions` (partnerProfileId+createdAt),
      `track_progress` (agencyId+status), plus the legacy `referrals` indexes.
- [ ] No "query requires an index" errors in console on any list page.

### 1.3 Local env vars (`.env.local`)
- [ ] Firebase client + admin keys present (app boots).
- [ ] Stripe **test** keys: `STRIPE_SECRET_KEY` starts `sk_test_`,
      `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` starts `pk_test_`.
- [ ] `STRIPE_WEBHOOK_SECRET` set from `stripe listen` (starts `whsec_`).
- [ ] `MARKETPLACE_CHECKOUT_ENABLED=true` **(local test only)**.
- [ ] `PARTNER_COMMISSIONS_ENABLED=true` **only if** testing commissions locally.
- [ ] `PARTNER_NETWORK_EVENTS_ENABLED` unset (or `true` only for outbox testing).
- [ ] `BYOK_KEY_ENCRYPTION_SECRET` set if testing BYOK (`openssl rand -hex 32`).
- [ ] Restart `pnpm dev` after any env change.
- [ ] `stripe listen --forward-to localhost:3000/api/webhooks/stripe` running in
      a second terminal.

### 1.4 Build sanity
- [ ] `pnpm tsc --noEmit` passes with no errors.
- [ ] `pnpm build` completes (optional but recommended pre-launch).

---

## 2. Feature QA checklist

### 2.1 Product catalog + Product Manager (`/agency/products`)
- [ ] Page loads; owner-only (non-owner blocked).
- [ ] Create / edit product works; archive (not delete) works.
- [ ] Filters: status + product family.
- [ ] Readiness badge correct (Draft / Hidden / No prices / Test ready / N/A).
- [ ] **Save guard:** active + public + subscription + no price IDs is **blocked**.
- [ ] Test-mode activation checklist card renders.

### 2.2 Product Eligibility (`/agency/product-eligibility`)
- [ ] Owner-only. Requirement selector saves.
- [ ] Approve / pending / revoke partner eligibility works.
- [ ] Bulk: generate missing rows; auto-approve eligible (manual_approval skipped).
- [ ] Missing row ≠ approved.

### 2.3 Partner Admin (`/agency/partners`)
- [ ] Owner-only. List + search + filters.
- [ ] Approve / suspend / reactivate / terminate (status changes, never delete).
- [ ] `approvedAt` + `approvedByUid` stamped on approve/activate.
- [ ] Tier change, track assign/remove, referral code edit/regenerate.
- [ ] Detail tabs: Eligibility, Activity (attributed sales / commissions / referrals).

### 2.4 Training / Certification
- [ ] `/sa/[id]/training` loads; both tracks show; partner enrollment required.
- [ ] Module checklist saves; "Submit for review" only after all modules.
- [ ] Submit goes through `POST /api/training/[trackId]/submit` (server-validated).
- [ ] `/agency/certifications` owner-only; approve adds trackId to
      `completedTrackIds` + auto-approves eligible product rows (manual_approval skipped).
- [ ] Revoke removes trackId.

### 2.5 Credits Wallet
- [ ] `/sa/[id]/credits` shows balance + transactions (partner only).
- [ ] `/agency/credits` owner-only: initialize wallet, adjust (+/- with note), history.
- [ ] Deduction clamps at 0 (no negative balance).
- [ ] Dev-only `spend-test-credits`: idempotent on rerun; insufficient balance handled.

### 2.6 BYOK encrypted storage
- [ ] `BYOK_KEY_ENCRYPTION_SECRET` set → BYOK product detail "Your API key" section
      saves; only last 4 shown.
- [ ] `byok_keys` doc holds `encryptedKey` + `iv` + `authTag` (NO `apiKey`).
- [ ] `product_eligibility` holds only `byokKeyLast4` / `byokConfigured` (no key).
- [ ] Secret unset → save returns 500 config error, **no** key stored.
- [ ] Remove clears encrypted fields + last4.

### 2.7 Stripe test checkout
- [ ] `MARKETPLACE_CHECKOUT_ENABLED=true` locally; checkout creates a session.
- [ ] Test card `4242 4242 4242 4242` completes.
- [ ] Success → `/sa/[id]/marketplace/checkout/success?session_id=...&productId=...`.
- [ ] Cancel → `/sa/[id]/marketplace/checkout/cancel?productId=...`.
- [ ] Session lookup returns safe fields only (no PII/card data).

### 2.8 Marketplace purchases
- [ ] `marketplace_purchases/{sessionId}` written (idempotent on webhook retry).
- [ ] `/sa/[id]/marketplace/purchases` shows the row + Fulfilled badge.
- [ ] `/agency/marketplace-purchases` owner view + filters; Fulfillment column.

### 2.9 Fulfillment
- [ ] Paid purchase → `product_entitlements/{customerUserId}_{productId}` granted.
- [ ] Purchase doc backfilled: `entitlementId`, `fulfilledAt`, `fulfillmentSource: "webhook"`.
- [ ] Unpaid session → no entitlement.
- [ ] Duplicate webhook → no duplicate entitlement.

### 2.10 My Products (`/sa/[id]/marketplace/access`)
- [ ] Shows active entitlements for the current customer + sub-account only.
- [ ] "Access product" routes by family/access model (education→training,
      byok→product detail, credit→credits, subscription→cockpit, services→details).
- [ ] Revoke (admin) removes it from My Products live.

### 2.11 Entitlement admin (`/agency/entitlements`)
- [ ] Owner-only; filters (active/revoked/has-purchase/missing-purchase/family).
- [ ] Manage modal: revoke / reactivate / internal note.
- [ ] Revoke sets status revoked + revokedAt; reactivate restores active.

### 2.12 Fulfillment repair
- [ ] Paid purchase missing `fulfilledAt` shows "Not fulfilled" + "Grant access".
- [ ] Grant access → entitlement created + purchase stamped
      `fulfillmentSource: "manual_repair"` + `fulfilledByUid`.
- [ ] Idempotent (rerun → already_fulfilled, no duplicate).

### 2.13 Commission dashboard (`/agency/commissions`)
- [ ] With `PARTNER_COMMISSIONS_ENABLED=true`: commission events appear for
      attributed paid purchases.
- [ ] With flag off: no commission events created (writer returns skipped).
- [ ] Cockpit `/agency/revenue-os` shows commission + readiness card.

### 2.14 Partner network outbox (must stay dormant for v1)
- [ ] `PARTNER_NETWORK_EVENTS_ENABLED` **unset** → no events written.
- [ ] `/agency/partner-network-events` loads, shows empty (or dormant notice).
- [ ] (Optional local test only) flag on → entitlement.granted /
      marketplace.purchase.paid / commission.event.created recorded; idempotent.
- [ ] **Flag turned back OFF before launch.**

---

## 3. Required env vars (reference)

| Var | Required for | Launch default |
|---|---|---|
| `MARKETPLACE_CHECKOUT_ENABLED` | Marketplace checkout | off (set only when launching sales) |
| `PARTNER_COMMISSIONS_ENABLED` | Commission event creation | off (set only when commissions approved) |
| `PARTNER_NETWORK_EVENTS_ENABLED` | Outbox emission | off (dormant for v1) |
| `BYOK_KEY_ENCRYPTION_SECRET` | BYOK key encryption | set iff BYOK products used (`openssl rand -hex 32`) |
| `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe | **test** keys until full test pass |
| `STRIPE_WEBHOOK_SECRET` | Webhook fulfillment | required for fulfillment to run |
| `REVENUE_OS_SEED_ALLOW_PRODUCTION` | dev-only routes in prod | **never set in production** |

---

## 4. Production safety defaults

- [ ] `MARKETPLACE_CHECKOUT_ENABLED` **off** in production until launch approved.
- [ ] `PARTNER_COMMISSIONS_ENABLED` **off** in production until commissions approved.
- [ ] `PARTNER_NETWORK_EVENTS_ENABLED` **off** in production (no MLM in v1).
- [ ] `REVENUE_OS_SEED_ALLOW_PRODUCTION` unset — dev-only routes inert in prod.
- [ ] CRM Pro (and any unpriced product) remains **draft/hidden** until Stripe
      prices are configured. Never auto-activate.
- [ ] No MLM integration active; no MLM package installed.
- [ ] Stripe **live** keys only after the full §5 test flow passes in test mode.

---

## 5. End-to-end test flow (single happy path)

Run locally with `MARKETPLACE_CHECKOUT_ENABLED=true` + `stripe listen` running.

1. **Create/verify product** — `/agency/products` → create or open a test
   subscription product.
2. **Add Stripe test price ID** — paste a `price_...` (test mode) monthly and/or
   annual ID into the product.
3. **Activate only when ready** — set status **Active** + **Public** (the save
   guard blocks this if no price IDs).
4. **Verify readiness** — Product Manager badge = "Test ready"; optionally run
   `POST /api/dev-only/validate-subscription-product` → `activationChecklist`.
5. **Complete Stripe test purchase** — open product detail → checkout →
   `4242 4242 4242 4242` → success page lands at the success route.
6. **Verify marketplace purchase** — `marketplace_purchases/{sessionId}` exists;
   appears on `/sa/[id]/marketplace/purchases` and `/agency/marketplace-purchases`.
7. **Verify entitlement** — `product_entitlements/{uid}_{productId}` is active;
   purchase doc has `entitlementId` + `fulfilledAt` + `fulfillmentSource: webhook`.
8. **Verify My Products** — `/sa/[id]/marketplace/access` shows the product with
   the correct "Access product" button.
9. **Verify commission behavior** — if `PARTNER_COMMISSIONS_ENABLED=true` and the
   purchase was attributed (referral code + active commission rule + approved
   eligibility), a `commission_events` row exists and shows in the dashboard;
   if the flag is off, confirm **no** commission was created.
10. **Verify fulfillment repair (negative path)** — temporarily simulate a paid
    purchase with no entitlement (e.g. a purchase recorded while rules were
    pending) → `/agency/marketplace-purchases` shows "Not fulfilled" → "Grant
    access" → entitlement created, `fulfillmentSource: manual_repair`.
11. **Verify admin dashboards** — `/agency/revenue-os` cockpit (revenue,
    attribution, readiness card), `/agency/entitlements`, `/agency/credits`,
    `/agency/certifications` all render with the test data.

Pass = every step verified with no console errors. Only then consider live keys.

---

## 6. Rollback plan

If anything goes wrong after enabling sales, roll back in this order (fastest →
most surgical):

1. **Disable checkout** — set `MARKETPLACE_CHECKOUT_ENABLED` off (or remove);
   redeploy. New checkout sessions return 403 immediately.
2. **Disable commissions** — set `PARTNER_COMMISSIONS_ENABLED` off; the webhook
   commission writer returns skipped. Existing events unaffected.
3. **Disable partner event outbox** — set `PARTNER_NETWORK_EVENTS_ENABLED` off;
   emission becomes a no-op.
4. **Set product draft/hidden** — `/agency/products` → flip the affected product
   to Draft (auto-hides) so it leaves the marketplace.
5. **Revoke entitlement** (if a specific grant must be pulled) —
   `/agency/entitlements` → Manage → Revoke. Customer loses access on My Products.
6. **Void commission event** (if a payout must be stopped) — `/agency/commissions`
   → mark the event voided (status flow pending → voided).
7. **Refund** — issue the refund in Stripe; then revoke entitlement + void
   commission as above. (`refund.created` event wiring is a future phase.)

All rollback steps are reversible and operate on flags/status — none delete data.

---

## 7. No-Go blockers (launch is blocked if ANY is true)

- [ ] **Firestore rules not deployed** (or missing any Revenue OS / partner-network
      collection). → permission-denied, broken reads/writes.
- [ ] **Indexes missing / still Building** → list pages error.
- [ ] **`MARKETPLACE_CHECKOUT_ENABLED=true` in production accidentally** before
      launch is approved.
- [ ] **Stripe live keys in use before the full §5 test pass.**
- [ ] **A product is active + public with missing Stripe price IDs** (especially
      CRM Pro) → broken checkout / accidental exposure.
- [ ] **`BYOK_KEY_ENCRYPTION_SECRET` missing** while BYOK products are offered →
      key saves fail / would store unencrypted (route blocks this with 500).
- [ ] **A paid purchase has no entitlement** and was not repaired → customer paid,
      no access.
- [ ] **Commission event duplicate risk** — idempotency key path altered or
      `PARTNER_COMMISSIONS_ENABLED` toggled mid-flight without verification.
- [ ] **Any MLM / downline / rank / genealogy / binary / unilevel / team-volume /
      compensation-plan logic present in uGotLeads core** → must be zero.
- [ ] **`REVENUE_OS_SEED_ALLOW_PRODUCTION=true` in production** → dev-only routes
      become reachable.

---

## 8. This runbook explicitly did NOT

- Add or change any feature code.
- Install, clone, or connect the MLM package.
- Change checkout, Stripe, commission math, entitlements, credits, BYOK, or
  partner logic.

It is a release artifact. Execute the checklist; flip production flags only when
§7 is fully clear.
