# Your Agency CRM

A production-ready, multi-tenant CRM you can brand as your own and resell to your clients. Styled after GoHighLevel and HubSpot, scoped for small agencies. Self-hosted on your own infrastructure — no recurring platform fees, no per-contact tiers, no per-message tax.

> **Read first.** This boilerplate is shipped to you as source code; the landing page renders the white-label "custom" variant by default so signups land on **your** brand, not LeadStack's. Open [src/config/landing.ts](src/config/landing.ts) and fill in `CUSTOM_BRAND` (business name, tagline, support email, pricing tiers) before you deploy. **Easiest path: open this project in VS Code, install the Claude Code extension, and ask Claude `help me set up this project`** — it walks you through branding, Firebase, Stripe, Resend, Twilio, QStash, gitpage, and Vercel one step at a time. See [SETUP.md](SETUP.md) for the manual flow.

## What you're running

A two-tier multi-tenant CRM:

- **Agency** — your top-level workspace. One per deployment. You're the agency owner.
- **Sub-accounts** — one isolated workspace per client. Each has its own contacts, deals, pipeline, calendar, tasks, forms, automations, broadcasts, and (optionally) its own Twilio number. URL-scoped at `/sa/[subAccountId]/...`.
- **Members** — invite collaborators per sub-account with `subAccountAdmin` (full read/write + member management) or `subAccountCollaborator` (read/write only) roles.

## What's Included

| Surface | What it does |
|---|---|
| **Landing page (white-label)** | Two variants: `custom` (your brand, the default) or `leadstack` (the demo). Edit `CUSTOM_BRAND` in `src/config/landing.ts`. |
| **Auth** | Email/password signup + login + session cookies. First signup (matching `BOOTSTRAP_ADMIN_EMAIL`) becomes the agency owner; subsequent signups require a typed invite. |
| **Agency dashboard** | Sub-account picker + create new sub-account flow. |
| **Sub-account dashboard** | Live KPIs, pipeline snapshot, recent activity, quick actions. |
| **Contacts** | List + search, CRUD, notes + activity timeline, CSV import/export, bulk-email action. |
| **Pipeline** | 6-stage Kanban (`@dnd-kit`), drag-drop deals, lost-reason prompt. |
| **Calendar** | Month grid, manual events, optional contact link. |
| **Tasks** | Today / Overdue / Upcoming / Done tabs, due-today sidebar badge. |
| **Forms** | Drag-order builder, 6 field types, public hosted page at `/f/[id]`, iframe embed, auto-creates contact + optional deal on submit. |
| **Reports** | Date-range KPIs, pipeline funnel, won-revenue area chart, leads-by-source donut. |
| **Cmd+K global search** | Across contacts, deals, tasks, events, forms. |
| **Email** | Shared-sender via Resend (your verified domain), `Reply-To:` user's email so replies bypass the app. |
| **SMS** | Shared-sender via Twilio (env-var creds) **OR** per-sub-account dedicated Twilio (real-time inbound chat thread on the contact profile, opt-in per sub-account). |
| **Automations** | Speed-to-Lead recipe — SMS + email + owner notification on form submit. QStash-backed scheduling, send-window respect, HMAC-signed unsubscribe links. |
| **Broadcasts** | Bulk email to a filtered audience (all / tag / pipeline stage). Reuses automations infra; live per-recipient status. Hard cap 25k recipients. |
| **Website builder** | Each sub-account can publish a marketing site via gitpage.site (LocalSite or VSL funnel). Long sectioned form → queued build → live URL within minutes. |
| **Billing** | Stripe checkout + customer portal + webhooks. Pro recurring + Founders one-time price IDs shipped; rewire `src/lib/stripe/checkout.ts` for your model. |
| **Marketing tracking** | Drop in your Meta Pixel ID and/or Google Tag Manager container ID via env vars — both load site-wide (landing + hosted forms + dashboard). Form submissions auto-fire the Meta `Lead` event. GTM is the escape hatch for LinkedIn, TikTok, Hotjar, etc. |
| **Lead attribution** | Every public form submission captures `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `gclid`, document referrer, and landing URL — stored on the contact's `attribution` field. Source falls back to `utm_source` when present. |
| **Live chat** | Optional Crisp Chat integration. Every "talk to us" path in the LeadStack-branded marketing page routes through Crisp rather than `mailto:` — buyers can swap in any chat tool by editing one file. |
| **Settings** | Profile, theme, subscription, members, per-sub-account Twilio config, send-window, CSV export. |

## Tech Stack

- **Next.js 15** — App Router, TypeScript, Turbopack
- **Firebase** — Authentication + Cloud Firestore + Admin SDK
- **`next-firebase-auth-edge`** — Session cookie auth at the edge
- **Stripe** — Checkout + Customer Portal + Webhooks
- **Resend** — Shared-sender email
- **Twilio** — Shared-sender + per-sub-account dedicated SMS
- **Upstash QStash** — Message queue for automation step scheduling + website build polling
- **gitpage.site** — Per-sub-account website builder
- **`@dnd-kit`** — Kanban drag-drop
- **`@tanstack/react-table`** — Contacts table
- **Tailwind CSS v4** + **shadcn/ui** — Theming with Geist Sans + Instrument Serif
- **Meta Pixel + Google Tag Manager** — Optional site-wide tracking scripts (script-tag pattern; both load via env var, both load `<noscript>` fallbacks)
- **Crisp Chat** — Optional live-chat widget; used as the primary support channel in place of `mailto:`
- **Vercel** — One-click deploy target

## Quick Start

> Full step-by-step in [SETUP.md](SETUP.md). Or open this project in VS Code with the Claude Code extension and type `help me set up this project` to be guided.

```bash
pnpm install
cp .env.example .env.local
# Fill in every value in .env.local — see SETUP.md
firebase login
firebase use <your-firebase-project-id>
firebase deploy --only firestore:rules
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### What you need before you start

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project (Auth + Firestore enabled)
- A Stripe account (test mode for dev)
- A Resend account + verified sending domain (optional — email disables gracefully if missing)
- A Twilio account + phone number (optional — SMS disables gracefully if missing)
- An Upstash QStash account (optional — automations + website-builder polling disable gracefully if missing)
- A gitpage.site agency API key (optional — website builder disables gracefully if missing)
- A Meta Pixel ID and/or Google Tag Manager container (optional — both load only when set; UTM/fbclid capture works regardless)
- A Crisp Chat website ID (optional — chat widget + "talk to us" CTAs silently no-op if missing)

### Brand the landing page

Open [src/config/landing.ts](src/config/landing.ts) and fill in `CUSTOM_BRAND` with your business name, tagline, support email, primary domain, and pricing tiers. The `LANDING_VARIANT = "custom"` default makes your branded page render at `/`.

If you're forking this to keep running the LeadStack demo, flip `LANDING_VARIANT` to `"leadstack"`.

## Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm start` | Production server |
| `pnpm lint` | Run ESLint |
| `pnpm format` | Format with Prettier |
| `firebase deploy --only firestore:rules` | Deploy security rules (re-run whenever you add a collection) |

## Project Structure

```
src/
├── app/
│   ├── (auth)/                       Login + Signup
│   ├── (legal)/                      Terms + Privacy
│   ├── (dashboard)/
│   │   ├── agency/                   Agency landing + sub-account picker
│   │   └── sa/[subAccountId]/        Per-sub-account CRM (dashboard, contacts,
│   │                                 pipeline, calendar, tasks, forms, reports,
│   │                                 automations, broadcasts, website, settings)
│   ├── f/[formId]/                   Public hosted form
│   ├── u/[token]/                    Public unsubscribe landing
│   ├── thank-you/                    Post-signup landing
│   └── api/
│       ├── auth/                     Signup + refresh-claims
│       ├── agency/                   Agency PATCH + sub-account CRUD
│       ├── sub-accounts/[id]/        Invites, members, twilio, website
│       ├── contacts/[id]/            DELETE (cascading)
│       ├── forms/[id]/submit/        Public submission
│       ├── comms/{email,sms}/send/   Auth-required send routes
│       ├── automations/step/         QStash callback (one recipe step)
│       ├── broadcasts/email/         Bulk email send + per-recipient step
│       ├── u/[token]/                Unsubscribe flip
│       ├── checkout/founders/        Founders one-time checkout
│       ├── cron/gitpage-heartbeat/   Daily telemetry + status cache
│       └── webhooks/                 Stripe + Twilio inbound
├── components/
│   ├── ui/                shadcn/ui primitives
│   ├── landing/           LeadStack-branded marketing page
│   ├── landing-custom/    White-label marketing page (reads CUSTOM_BRAND)
│   ├── agency/            Agency landing + SA switcher
│   ├── dashboard/         Sidebar + Header + Cmd+K trigger
│   ├── contacts/ pipeline/ calendar/ tasks/ forms/ reports/
│   ├── automations/       Recipe + template UI
│   ├── search/            Cmd+K palette
│   └── settings/          Members + per-SA Twilio config
├── config/
│   └── landing.ts         LANDING_VARIANT + CUSTOM_BRAND
├── lib/
│   ├── firebase/          Client + admin SDK + auth helpers
│   ├── stripe/            Checkout + portal + webhooks
│   ├── comms/             Resend + Twilio + per-SA config + route-auth + usage
│   ├── firestore/         CRUD helpers per collection
│   ├── automations/       Triggers, executor, QStash, merge tags, tokens
│   ├── broadcasts/        Audience filter resolution
│   ├── gitpage/           Client SDK + heartbeat telemetry
│   ├── website/           gitpage dropdown values, niche templates, validation
│   ├── attribution.ts     Browser UTM/fbclid/referrer capture + Meta Pixel Lead helper
│   ├── crisp.ts           Typed openCrispChat() wrapper (no-op when widget not loaded)
│   ├── auth/              require-admin + require-tenancy guards
│   └── health/            Liveness checks
├── hooks/                 useAuth, useSubAccount, useDueTodayCount
├── context/               AuthContext + SubAccountContext
├── types/                 Per-domain types
└── middleware.ts          Auth gating (next-firebase-auth-edge)

instrumentation.ts         Cold-start gitpage heartbeat
firestore.rules            Tenancy + role-based security rules
firebase.json              Deploys firestore.rules only
```

## Firestore Collections

All collections are **tenancy-scoped** via `firestore.rules`. Every CRM doc carries `agencyId`, `subAccountId`, `createdByUid`; the rules check the caller's `subAccountMembers/{uid}` row (or the agency-owner shortcut) before allowing reads/writes.

| Collection | Notes |
|---|---|
| `agencies/{id}` + `/agencyMembers/{uid}` | Agency profile, billing, owner/staff list |
| `subAccounts/{id}` + `/subAccountMembers/{uid}` | Workspace metadata, send-window, Twilio config, per-SA membership rows |
| `subAccounts/{id}/website/main` | Singleton gitpage.site build config + status |
| `userMemberships/{uid}/subAccounts/{saId}` | Denormalized index for the sub-account switcher |
| `users/{uid}` | Slim profile (display name, photo, primary agency) |
| `appConfig/main` | Bootstrap singleton (first agency owner) |
| `system/heartbeat`, `system/gitpageStatus` | Telemetry + cached subscription status |
| `invites/{auto}` | Typed invites with subAccountId + role |
| `contacts/{id}` + `/notes` + `/activities` + `/messages` | CRM contacts (messages = SMS chat thread when dedicated Twilio is on) |
| `deals/{id}` | Pipeline deals (1 contact → many deals) |
| `tasks/{id}` `events/{id}` `forms/{id}` | Todos, calendar events, form configs |
| `forms/{id}/submissions/{id}` | Inbound submissions (server-write only) |
| `automations/{id}` + `message_templates/{id}` + `automation_executions/{id}` | Recipe configs, reusable email/SMS templates, per-firing run rows |
| `broadcasts/{id}/sends/{contactId}` | Bulk email batches with per-recipient status |
| `usage/{subAccountId}/...` | Email + SMS quota counters |
| `mail/{id}` | Firebase Trigger-Email extension queue |

## Deployment

**Local → Vercel** with all env vars copied from `.env.local`. Full walkthrough in [SETUP.md → Phase 5](SETUP.md#phase-5-run-locally--push-to-live), including:

- Stripe webhook endpoint pointing at production
- Twilio inbound webhook URL pointing at production
- `NEXT_PUBLIC_APP_URL` set to your Vercel domain (QStash + gitpage callbacks read this)

## Security Notes

- **Zero embedded secrets.** Every credential is user-provided via env vars. `.env*` is gitignored except `.env.example`.
- **Tenancy-scoped Firestore rules.** Caller's `subAccountMembers/{uid}` doc (or agency-owner claim shortcut) controls access on every read/write.
- **Admin SDK guarded.** `lib/firebase/admin.ts` uses `import "server-only"` so it can never leak into the client bundle.
- **Public write paths** (`/api/forms/[id]/submit`, `/api/u/[token]`, QStash callback routes, Stripe + Twilio webhooks) all validate input, signature-verify where applicable, and use the admin SDK to bypass rules cleanly.
- **HMAC-signed unsubscribe links** prevent forgery; rotating `AUTOMATIONS_TOKEN_SECRET` invalidates all outstanding links.
- **CAN-SPAM compliance**: every email body (one-off + bulk) is validated to contain `{{unsubscribeLink}}` before sending.

---

## About this boilerplate (LeadStack source notes)

This codebase is shipped as **LeadStack** — a one-time-purchase agency CRM boilerplate.

- **License**: MIT — keep, modify, fork, resell as a service to your own clients however you like.
- **Pricing of the boilerplate itself**: $1,497 (repo only) / $3,997 (fully implemented with hands-on setup). After purchase, there are no recurring LeadStack fees and no per-contact/per-message tax — your only ongoing costs are what Firebase, Stripe, Resend, Twilio, Upstash, gitpage, and Vercel charge for your usage.
- **Support**: open issues on your private fork or contact the LeadStack team via your purchase confirmation email.
- **Brand**: the included LeadStack-branded landing page (under `src/components/landing/`) is what's shown on the public demo at leadstack.io. For your own deployment you should leave `LANDING_VARIANT = "custom"` and fill in `CUSTOM_BRAND` with your own business details — that's what your end-customers will see at `/`.

If you ever want to compare against the LeadStack demo, you can flip `LANDING_VARIANT` to `"leadstack"` in `src/config/landing.ts` without touching any other code.
