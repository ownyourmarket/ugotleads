# UGotLeads CRM (LeadStack base)

## SOUL Files — Read First

This deployment is branded as **UGotLeads** by Star Riley / MyUSA. Before working on any task, read the relevant SOUL files:

1. Always read `/soul/brand/SOUL.md` before working on UGotLeads.
2. If a task matches a specialized agent, also read that agent's SOUL.md.
3. For code tasks, read `/soul/agents/code-engineer/SOUL.md`.
4. For marketing copy, read `/soul/agents/marketing-copywriter/SOUL.md`.
5. For risky claims, offers, partner language, or income-related copy, read `/soul/agents/compliance-reviewer/SOUL.md`.
6. For onboarding flows or user setup help, read `/soul/agents/customer-onboarding/SOUL.md`.
7. For business strategy, launch priorities, pricing, and revenue planning, read `/soul/agents/founder-operator-advisor/SOUL.md`.

---

## Audience for this document

This file is written for **the buyer who just cloned the repo** and is setting it up — usually with Claude Code's help. The default ship state is `LANDING_VARIANT = "custom"`, meaning the landing page is a white-label CRM template the buyer brands as their own (via `CUSTOM_BRAND` in `src/config/landing.ts`). The buyer's deployment becomes their product, not "LeadStack".

Everywhere you see `LeadStack` referenced below, that's just the name of the repo + codebase you're working with. References to `leadstack.dev` are placeholders for the public LeadStack demo site — substitute **your own deployment domain** (e.g. `your-product.vercel.app`) anywhere you see it.

Two pockets of the codebase are LeadStack-marketing-specific and won't apply to a buyer running the `custom` variant: the **founders cohort** (sold-out counter, exit-intent modal, founders pricing card) and the **LeadStack-branded landing page** (`LANDING_VARIANT = "leadstack"`). Both are clearly labeled in the sections below — feel free to skip those when reading.

## Project Overview
A production-ready, all-in-one CRM styled after GoHighLevel and HubSpot, scoped for small teams. Sold as a one-time purchase ($1,497 repo only / $3,997 fully implemented) — buyers self-host, brand it as their own, and sell to their clients however they like.

The codebase ships with every core surface already functional: contacts, pipeline, calendar, tasks, forms (with public hosted pages + iframe embed), reports, global search, shared-sender email + SMS, plus AI Agents (Web Chat widget + SMS auto-replies) sharing one persona per client sub-account. All external dependencies are user-provided credentials; the repo contains no embedded secrets.

## Auth & Tenancy Model

LeadStack is a **GHL-style multi-tenant CRM**: an agency operator owns one or more **sub-accounts**, each an isolated workspace with its own contacts, deals, pipeline, etc. Sub-accounts are URL-scoped at `/sa/[subAccountId]/...`.

### Hierarchy

- **Agency** (`agencies/{agencyId}`): top-level tenant. One per deployment in v1. Owner is the first signup.
- **Sub-account** (`subAccounts/{subAccountId}`): a workspace inside an agency. Holds the per-client data.
- **Membership**: `subAccounts/{saId}/subAccountMembers/{uid}` rows track who can access each sub-account and at what role.

### Roles

- **agencyOwner** — the bootstrap user. Implicit `admin` inside every sub-account in their agency. Manages billing.
- **subAccountAdmin** — manages members + settings of one sub-account. Full read/write inside it.
- **subAccountCollaborator** — read/write data inside one sub-account. No member management.

### Claims & rules

- Custom claims (set by `/api/auth/signup` and `/api/auth/refresh-claims`): `{ role, status, agencyId, agencyRole }`. All scalars — JWT size cap forbids per-sub-account membership lists.
- Per-sub-account memberships live in Firestore. Rules read them via `get()` once per request.
- Agency-owner shortcut: rule passes on claim comparison (0 `get()`s) when `agencyRole == "owner"` and `agencyId` matches the doc's agency.

### First signup → agency owner

`/api/auth/signup` runs a transaction on `appConfig/main`. If it doesn't exist, the signing-up user (gated by `BOOTSTRAP_ADMIN_EMAIL`) becomes the agency owner; the route mints an agency, a default "Main" sub-account, owner+admin memberships, and the user's claims. Subsequent signups must match an unrevoked, unaccepted `invites/{auto}` doc that names a specific sub-account + role.

### Tenancy keys on every doc

Every doc in `contacts`, `deals`, `tasks`, `events`, `forms`, `usage` carries:
- `agencyId` (for the agency-owner shortcut in rules)
- `subAccountId` (the primary tenancy key, used in client `where()` queries)
- `createdByUid` (audit only)

Subcollections (`contacts/{id}/notes`, `forms/{id}/submissions`, etc.) inherit tenancy via the parent — rules read the parent's `subAccountId`.

### Removal

Removing a member from a sub-account sets the membership doc's status to `removed` and drops the user's `userMemberships` index entry. If the user has no other active memberships and no agency role, their `users/{uid}.status` flips to `removed`, custom claims update to `status: "removed"`, and the Firebase Auth user is disabled. AuthContext force-signs-out on next page load.

### Routing

- `/agency` — agency landing page with sub-account picker.
- `/agency/sub-accounts` — list + create.
- `/agency/sub-accounts/new` — create form.
- `/sa/[subAccountId]/dashboard` etc. — per-sub-account CRM pages, mounted under `<SubAccountProvider/>`.
- Legacy `/contacts`, `/dashboard`, etc. are stub pages that redirect to the user's first-membership sub-account (kept so external links like the landing nav still work).

### `useAuth()` and `useSubAccount()`

- `useAuth()` exposes `user`, `agencyId`, `agencyRole`, `memberships[]`, plus a legacy `adminUid` that is still populated for back-compat with components that haven't migrated.
- `useSubAccount()` (only mounted inside `/sa/[subAccountId]/`) exposes the active sub-account, the caller's effective role (`isAdmin`), and `saPath(path)` for templating internal links.

## Landing-page variant (white-label)

`src/config/landing.ts` exports `LANDING_VARIANT` and `CUSTOM_BRAND`. The root `app/page.tsx` renders one of two complete marketing pages based on the toggle:

- **`"custom"` (default)** — a generic agency-CRM landing the buyer brands as their own product. Pulls all copy from `CUSTOM_BRAND` (`name`, `tagline`, `shortDescription`, `supportEmail`, `primaryDomain`, `pricing.{starter, pro, scale}`). Renders 5 sections (hero, features, pricing, FAQ, CTA) wrapped in navbar + footer. The buyer edits `CUSTOM_BRAND` before deploy so signups land on their brand, not LeadStack's.
- **`"leadstack"`** — the LeadStack-branded marketing landing used on the leadstack.io demo site. 11 sections (hero, how-it-works, workspace-tour, features, comparison, make-it-yours, pricing, FAQ, CTA, etc.). Flip back to this only if you're running the public LeadStack demo.

The `(dashboard)/` CRM surface, auth flow, agency/sub-account model, and all features below are landing-variant-agnostic — only the marketing page at `/` changes.

## Tech Stack
- **Framework:** Next.js 15 (App Router, Turbopack) with TypeScript
- **Auth:** Firebase Authentication (email/password) + `next-firebase-auth-edge` session cookies + custom claims (`role`, `status`)
- **Database:** Cloud Firestore (owner-scoped security rules)
- **Payments:** Stripe Checkout + Billing Portal + Webhooks
- **Email:** Resend (shared-sender, LeadStack owns the account; cost baked into plan price)
- **SMS:** Twilio (same shared-sender model)
- **AI replies:** OpenRouter as the model gateway (one key, any model). Default to Claude Haiku 4.5 for cost/quality; per-channel override possible.
- **Website KB scrape:** Firecrawl (`/v1/scrape`, agency-level key). Powers the optional homepage knowledge base on the AI Agent profile.
- **Kanban:** `@dnd-kit/core` (draggable deals across stages)
- **Tables:** `@tanstack/react-table` (contacts list)
- **Styling:** Tailwind CSS v4 + shadcn/ui + Geist Sans + Instrument Serif (display accents)
- **Theming:** next-themes (light / dark / system)
- **Toasts:** sonner
- **Marketing tracking:** Meta Pixel + Google Tag Manager (script tags conditional on env vars, identical pattern to Crisp)
- **Live chat / support:** Crisp Chat (widget loaded site-wide when configured; used as the primary support channel in place of mailto)
- **Deployment:** Vercel

## Core Features (all shipped)
- **Contacts** — list + search, add/edit modal, profile with notes + unified activity timeline, CSV import/export
- **Pipeline / Kanban** — `@dnd-kit` 6-stage board (New → Contacted → Qualified → Proposal → Won / Lost), deal cards with value + days-in-stage, lost-reason prompt
- **Calendar** — manual events, month grid with click-to-add, optional contact linking, activity write on create
- **Tasks** — Today / Overdue / Upcoming / Done, due-today badge in sidebar, linkable to contacts
- **Forms** — drag-order field builder, 6 field types, `mapsTo` contact fields, public page at `/f/[id]`, iframe embed, auto-creates contact + optional deal on submit
- **Reports** — date-range KPIs, pipeline funnel, won-revenue area chart, leads-by-source donut, inline SVG (no chart library)
- **Cmd+K search** — global palette across contacts, deals, tasks, events, forms
- **Leads map** — Mapbox-powered world map on the sub-account dashboard with clustered pins. Location captured server-side at form submit (ipapi.co + phone country-code fallback). Renders graceful empty / "not configured" states when no token or no located contacts.
- **Email + SMS** — from a contact profile, shared LeadStack sender with user's email on `Reply-To` so replies bypass the app
- **AI Agents** — one persona (system prompt + business hours + escalation keywords + optional Firecrawl-scraped website KB) shared across every active channel. Ships with two live channels: **Web Chat** (embeddable iframe widget with inline lead-capture form) and **SMS** (auto-replies to inbound SMS on the sub-account's dedicated Twilio number). Captures trigger automatic Task + escalation email. Operator console at AI Agents → Web Chat → Sessions for live transcripts. Voice + Email + Google Business Profile on the roadmap.
- **Billing** — Stripe checkout + customer portal + webhooks, Free / Pro / Scale plans
- **Marketing attribution** — every public form submission captures `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `gclid`, document referrer, and landing-page URL from the visitor's browser, then stores them on the contact's `attribution` field. `source` falls back to `utm_source` when present. Fires Meta Pixel `Lead` event client-side on successful submit.
- **Settings** — profile edit, theme, subscription, CSV export, sign-out

## Project Structure
```
src/
  app/
    (auth)/                       Login + Signup pages
    (legal)/                      Terms of Service + Privacy Policy
    (embed)/                      Iframe-able routes that bypass dashboard chrome
      embed/chat/[subAccountId]/  AI Agents Web Chat widget iframe target
    (dashboard)/                  Protected pages
      agency/                     Agency landing + sub-account picker
        get-started/              First-run onboarding (after agency owner signup)
        sub-accounts/             List + create new sub-account
      sa/[subAccountId]/          Per-sub-account CRM (the working surface)
        dashboard/                Home: KPI summary + pipeline snapshot + activity
        dashboard/settings/       Profile, theme, subscription, members, SMS, send-window
        contacts/                 List + [id] profile (notes, activities, send email/SMS)
        pipeline/                 6-stage Kanban (drag-drop deals)
        calendar/                 Month grid + events
        tasks/                    Today / Overdue / Upcoming / Done
        forms/                    Builder list + [id] editor (drag-order fields, mapsTo)
        reports/                  Date-range KPIs + funnel + charts
        automations/              Recipe list + activity logs + settings + templates
        broadcasts/               Bulk-email list + [id] detail (live status)
        website/                  gitpage.site builder (long sectioned form)
        ai-agents/                Shared persona + KB (Overview) + per-channel pages
          (page.tsx)              Overview: AgentProfileSection + channel status grid
          web-chat/               Web Chat settings (toggle, theme, allowed domains, snippet)
          web-chat/sessions/      Live operator console — list + [sessionId] transcript
          sms/                    SMS channel settings (toggle, model, escalation)
          voice/ email/ google-business/  Coming-soon placeholders
      contacts/ dashboard/ ...    Legacy flat routes — redirect to the first sub-account
    f/[formId]/                   Public hosted form (unauthenticated)
    u/[token]/                    Public unsubscribe landing (unauthenticated)
    thank-you/                    Post-signup landing
    api/
      auth/signup/                Create user; first-signup bootstrap mints agency + Main SA
      auth/refresh-claims/        Re-mint custom claims after membership changes
      agency/                     PATCH agency, list/create sub-accounts, gitpage-status refresh
      sub-accounts/[id]/
        invite/                   Create + accept member invites
        members/[uid]/            Update role / revoke access
        twilio/                   Save dedicated Twilio creds (auto-wires inbound webhook)
        website/build|poll|       gitpage build, QStash poll callback, manual repoll, reset
        website/poll-now|DELETE
      contacts/[id]/              DELETE contact + subcollections + referencing deals/tasks
      forms/[id]/submit/          Public form submission (unauthenticated; admin SDK)
      comms/email/send/           Send email (Resend, shared-sender)
      comms/sms/send/             Send SMS (Twilio, env-var or per-SA dedicated)
      automations/step/           QStash callback — executes one Speed-to-Lead step
      broadcasts/email/send/      Initiate bulk email (validate + fan out to QStash)
      broadcasts/email/step/      QStash callback — sends one recipient's email
      u/[token]/                  POST unsubscribe (flips contact.emailOptedOut)
      checkout/founders/          Stripe checkout for Founders one-time tier
      cron/gitpage-heartbeat/     Daily QStash-scheduled telemetry + status cache
      webhooks/stripe/            Stripe subscription webhook
      webhooks/twilio/inbound/    Inbound SMS (STOP/START opt-out + chat-thread writes + AI auto-reply)
      sub-accounts/[id]/
        ai-agent/profile/         GET/PATCH shared agent profile (persona, hours, KB)
        ai-agent/profile/         POST refresh-kb → Firecrawl scrape of websiteUrl
          refresh-kb/
        ai-agent/channels/        GET/PATCH per-channel config (enabled, model, overrides)
          [channel]/
        ai-agent/test/            POST dry-run the persona against a test message
      web-chat/config/            GET widget config (theme + welcome). Origin-gated.
      web-chat/message/           POST visitor message → bot reply. Rate-limited.
      web-chat/capture/           POST inline-form submit → Contact + Task + escalation email
      dev-only/danger-wipe-       DEV TESTING ONLY — wipes everything in the agency
        everything/               (owner-gated; not for production use)
  components/
    ui/                  shadcn/ui primitives
    auth/                Login + signup forms
    landing/             LeadStack-branded marketing page (sections + exit-intent-modal urgency popup + Buy Now header / Admin footer split)
    landing-custom/      White-label marketing page (navbar, hero, features, pricing, FAQ, CTA, footer)
    brand/               Brand mark / logo components used by both landings
    agency/              Agency landing + sub-account picker UI
    dashboard/           Sidebar + Header (dynamic title + Cmd+K trigger + SA switcher)
    contacts/            Table, profile, activity timeline, send-email/sms + bulk-email dialogs
    pipeline/            Board, deal card, new-deal + lost-reason dialogs
    calendar/            Month view + event dialog
    tasks/               Task item + task dialog
    forms/               Public form renderer + builder pieces
    reports/             SVG chart primitives
    automations/         Recipe attach UI, template editor, history viewer
    ai-agents/           Channel nav tabs + AgentProfileSection (persona+KB) + SMS/WebChat channel sections + WebChatSessionsList + WebChatSessionThread
    web-chat/            ChatWindow component rendered inside the embed iframe (self-contained, immune to host CSS)
    analytics-scripts.tsx  Crisp/GTM/Pixel loader — skips on /embed/* so the chat iframe doesn't render a nested support widget
    search/              Cmd+K command palette
    settings/            Sub-account members + per-SA Twilio config sections
  config/
    landing.ts           LANDING_VARIANT toggle + CUSTOM_BRAND fields (white-label config)
  lib/
    firebase/            Client + admin SDK (admin uses "server-only" guard) + auth helpers
    stripe/              Checkout + portal + webhooks + client/server helpers
    comms/               Resend + Twilio wrappers, route-auth, usage counter, SMS segments, per-SA config
    comms/ai/            AI Agents: agent.ts (profile + per-channel resolver + lazy migration), respond.ts (SMS orchestrator), prompt.ts (channel-aware system prompt + KB injection), context.ts (contact context block), escalation.ts (keyword match + email notify), openrouter.ts (LLM client)
    comms/web-chat/      Web Chat: session.ts (get-or-create + history + capture-state), respond.ts (orchestrator returning reply over HTTP), capture.ts (parse [[form]] + [[capture]] markers, Contact reconciliation), follow-up.ts (post-capture Task + escalation email), origin.ts (Origin allowlist), rate-limit.ts (in-memory IP + session caps)
    firecrawl/           client.ts — agency-level scrape wrapper (/v1/scrape, 30s timeout, FirecrawlError)
    firestore/           CRUD helpers per collection (contacts, deals, tasks, events, forms, activities, users, mail, web-chat-sessions)
    automations/         triggers, executor, qstash, merge-tags, unsubscribe-token, seed-templates, template-presets
    broadcasts/          audience.ts (filter resolution for bulk email recipients)
    contacts/            location.ts (IP geo via ipapi.co + phone country-code parsing + country centroids)
    landing/             resolve-brand.ts (server-side: merges agency doc over CUSTOM_BRAND for the custom landing)
    gitpage/             client.ts (gitpage REST SDK) + heartbeat.ts (telemetry + status cache)
    website/             gitpage-values.ts (curated dropdown values), niches.ts, validation.ts
    forms/               Form appearance/styling helpers
    auth/                require-admin, require-tenancy guards
    health/              Liveness checks (incl. OpenRouter + Firecrawl checks under the ai-agents category)
    attribution.ts       readAttributionFromBrowser() + trackLeadEvent() — captures UTM/fbclid/gclid/referrer/landing-page from URL params and fires Meta Pixel Lead event on form submit
    crisp.ts             openCrispChat() — typed wrapper around the global $crisp queue; safe no-op when the widget isn't loaded
    csv.ts               CSV parse + serialize + contact-field fuzzy matcher
    format.ts            Date / relative-time / currency formatters
    utils.ts             cn() class merger
  hooks/                 useAuth, useSubAccount, useDueTodayCount, etc.
  context/               AuthContext + SubAccountContext providers
  types/                 Per-domain TypeScript types
  middleware.ts          Auth gating (next-firebase-auth-edge); PUBLIC_PATHS + PUBLIC_PATH_PATTERNS (includes /api/web-chat + /embed + /widget.js)
public/widget.js         Vanilla JS widget loader (~4KB). Snippet on the buyer's clients' sites pulls this file; it injects a floating bubble + lazy-loads the iframe pointing at /embed/chat/[saId].
next.config.ts           Headers config — CSP frame-ancestors * for /embed/* so the chat iframe loads cross-origin; CORS + cache-control on /widget.js.
instrumentation.ts       Cold-start gitpage heartbeat ping
firestore.rules          Tenancy + role-based security rules
firebase.json            Deploys firestore.rules only
```

## Firestore Collections
| Collection | Scope | Notes |
|---|---|---|
| `agencies/{agencyId}` | agency-read | Agency profile + Stripe billing (one per deployment in v1) |
| `agencies/{agencyId}/agencyMembers/{uid}` | agency-read | Owner / staff list |
| `subAccounts/{subAccountId}` | members + agency owner | Workspace metadata; reserved fields for Workflow-Recipes Twilio/Resend/booking/sendWindow |
| `subAccounts/{subAccountId}/subAccountMembers/{uid}` | admins | Per-sub-account membership rows |
| `userMemberships/{uid}/subAccounts/{saId}` | self-read | Denormalized index powering the sub-account switcher |
| `userMemberships/{uid}/agencies/{agencyId}` | self-read | Denormalized index for agency-level access |
| `users/{uid}` | self only | Slim profile (display name, photoURL, primaryAgencyId) |
| `appConfig/main` | active members | Bootstrap singleton: `firstAgencyId`, `firstAgencyOwnerUid` |
| `system/heartbeat` | server-only | Instance id + last-heartbeat timestamp (anonymous telemetry) |
| `system/gitpageStatus` | active members read | Cached gitpage subscription state; drives the activate-banner UI |
| `invites/{auto}` | agency owner / sub-account admin | Typed invites (carry `subAccountId` + `subAccountRole`) |
| `contacts/{id}` | sub-account | Carries `agencyId`, `subAccountId`, `createdByUid` |
| `contacts/{id}/notes/{id}` | inherits | Free-text notes |
| `contacts/{id}/activities/{id}` | inherits | Typed events |
| `deals/{id}` | sub-account | One contact → many deals |
| `events/{id}` | sub-account | Calendar events |
| `tasks/{id}` | sub-account | Todos |
| `forms/{id}` | sub-account | Form config |
| `forms/{id}/submissions/{id}` | sub-account read, server-write | Inbound submissions; route stamps tenancy from the form doc |
| `usage/{subAccountId}/users/{uid}` | self/owner read | Email + SMS quotas |
| `mail/{id}` | server-only | Trigger-Email extension queue |
| `automations/{id}` | sub-account; admin-write | Recipe configs (one per attached form). Carries `agencyId`, `subAccountId`, `recipeType`, `trigger`, `config`, `enabled` |
| `message_templates/{id}` | sub-account; admin-write | Reusable email + SMS bodies with merge tags |
| `automation_executions/{id}` | sub-account read; server-only write | Per-firing run rows; the QStash callback executor mutates these |
| `contacts/{id}/messages/{id}` | sub-account read; server-only create/delete; client `readAt`-only update | SMS chat thread when the sub-account has dedicated Twilio enabled. Doc id = Twilio MessageSid for natural dedupe on retries. |
| `broadcasts/{id}` | sub-account read; server-only write | Bulk-email batch metadata (template, audience filter, totals, status). One per "Send bulk email" action. |
| `broadcasts/{id}/sends/{contactId}` | sub-account read; server-only write | Per-recipient delivery row. Doc id = contactId for natural dedup. Status: queued/sent/skipped/failed. Carries Resend message id + error string. |
| `purchases/{sessionId}` | server-only | Anonymous one-time purchases (founders cohort). Doc id = Stripe checkout session id (natural dedup key for retried webhook deliveries). Carries `email`, `wave`, `amountPaidCents`, `welcomeEmailMessageId`, `welcomeEmailSentAt`. Written by the Stripe webhook handler via Admin SDK. |
| `subAccounts/{id}/aiAgent/profile` | sub-account read; server-only write | Shared AI Agent identity. `systemPrompt`, `businessName`, `hoursStart/End`, `timezone`, `escalationKeywords`, `escalationNotifyEmail`, plus optional `websiteUrl` + `websiteKb` (Firecrawl snapshot, ≤6000 chars) + `websiteKbFetchedAt`. One per sub-account. |
| `subAccounts/{id}/aiAgent/{channelId}` | sub-account read; server-only write | Per-channel operational config. Channels today: `sms`, `web-chat`. Carries `enabled`, `contextMessageCount`, `modelOverride`, `escalationKeywordsOverride`, `escalationNotifyEmailOverride`, `totalTokensUsed`. The `web-chat` doc additionally holds a nested `webChat` block: `allowedDomains`, `welcomeMessage`, `accentColor`, `position`. |
| `subAccounts/{id}/aiConfig/main` | sub-account read; server-only write | **Legacy.** Pre-refactor combined config. Kept readable so `lib/comms/ai/agent.ts::maybeMigrateLegacy()` can lazily split it into the new `aiAgent/profile` + `aiAgent/sms` shape on first read. Safe to remove after every sub-account has been migrated. |
| `subAccounts/{id}/webChatSessions/{sessionId}` | sub-account read; server-only write | One row per Web Chat thread. Anonymous-first — `contactId: null` until the bot captures identity. Carries `pageUrl`, `referrer`, `origin`, `visitorIp`, `visitorUserAgent`, `status` (active/closed/escalated), `messageCount`, `tokensUsed`, `capturedName/Email/Phone`, `capturePromptShownAt`, `captureSkipped`, `pendingFollowUpTaskId`. Session id = a UUID generated client-side and stored in localStorage. |
| `subAccounts/{id}/webChatSessions/{id}/messages/{id}` | sub-account read; server-only write | Per-turn transcript. `direction` inbound/outbound, `body`, `tokens`, `aiGenerated`. Visitor sees the body with any `[[capture …]]` / `[[form …]]` markers stripped. |

## Key Architecture
- **Firebase Client SDK** (`lib/firebase/client.ts`) — browser only
- **Firebase Admin SDK** (`lib/firebase/admin.ts`) — server only (`import "server-only"` guard)
- **Middleware** — protects every route except `PUBLIC_PATHS` (`/`, `/login`, `/signup`, `/terms`, `/privacy`, `/f/*`, `/api/forms/*`). Attaches `x-user-uid` + `x-user-email` to authenticated requests.
- **Comms routes** — `/api/comms/*` require auth; `requireUid()` + `requireContactOwner()` helpers in `lib/comms/route-auth.ts` enforce ownership before any send.
- **Public form submission** — `/api/forms/[id]/submit` uses admin SDK to bypass client-side Firestore rules; validates required fields, creates contact, optionally creates deal, writes `form_submitted` activity.
- **Activity timeline** — merges free-text notes + typed activities, sorted by `createdAt` desc. Icon + label mapped in `activity-timeline.tsx::activityVisuals()`.
- **Shared-sender comms** — user clicks Send email on a contact; Resend sends with `From: EMAIL_FROM` (verified LeadStack domain), `Reply-To: <user's email>`. Replies bypass LeadStack and land in the user's inbox.
- **Dedicated SMS per sub-account (opt-in)** — each sub-account can flip `twilioConfig.enabled = true` (Settings → SMS) and paste its own Twilio Account SID + Auth Token + From Number. When enabled: outbound `/api/comms/sms/send` uses that sub-account's creds; the inbound webhook routes by `To` number to that sub-account, validates against the sub-account's auth token, and writes both opt-out flips AND a chat-thread row to `contacts/{id}/messages`. The contact profile renders a Messages tab with a real-time SMS thread + composer. When disabled: existing env-var Twilio shared-sender behavior is fully preserved (no message storage, no chat thread). On save, the API auto-configures the inbound webhook URL on the operator's Twilio number via Twilio's REST API; if that fails (permissions, etc.) the settings UI surfaces the URL with a copy button for manual configuration. The inbound webhook ALSO drives the SMS AI agent when configured — see the AI Agents section below.
- **AI Agents (one persona, every channel)** — full architecture in the "AI Agents (Web Chat + SMS) v1" section below. TL;DR: a shared profile doc holds the persona, business hours, escalation keywords, and optional Firecrawl-scraped website KB. Per-channel docs hold the enabled toggle, model override, and channel-specific overrides. Web Chat ships an iframe widget + vanilla JS loader; SMS hooks into the existing inbound webhook. Captures auto-create a Task + send an escalation email.
- **Usage counters** — every `/send` bumps `usage/{uid}.email` / `.sms` + a `YYYY-MM` sub-bucket. No enforcement in MVP; hook for future plan-tier quotas.
- **Marketing attribution capture** — when a visitor hits a hosted form page at `/f/[id]`, [src/components/forms/public-form.tsx](src/components/forms/public-form.tsx) calls [src/lib/attribution.ts](src/lib/attribution.ts)::`readAttributionFromBrowser()` on mount to snapshot `utm_source/medium/campaign/content/term`, `fbclid`, `gclid`, `document.referrer`, and `window.location.href`. That snapshot is held in a `useRef` (so a post-submit URL rewrite doesn't lose it) and forwarded in the POST body to `/api/forms/[id]/submit`, which validates each field (≤500 chars, trimmed) via `normalizeAttribution()` and writes it to `contact.attribution`. `source` falls back to `utm_source` when set, otherwise the legacy `"website"`. After a successful submission, `trackLeadEvent()` fires a Meta Pixel `Lead` event client-side before any redirect — once the browser navigates the pixel script unloads with the page. **Iframe gotcha:** the captured URL is the iframe's URL, not the host page's (cross-origin blocks `window.parent.location`). Agencies embedding via iframe must encode UTMs in the iframe `src` for them to flow through.
- **Site-wide tracking scripts** — [src/app/layout.tsx](src/app/layout.tsx) conditionally loads Meta Pixel (when `NEXT_PUBLIC_META_PIXEL_ID` is set), Google Tag Manager (when `NEXT_PUBLIC_GTM_ID` is set), and Crisp Chat (when `NEXT_PUBLIC_CRISP_WEBSITE_ID` is set). All three follow the same `<Script strategy="afterInteractive">` pattern and ship `<noscript>` fallbacks where applicable (Pixel + GTM). Each is fully optional — leave the env unset to skip. GTM is the documented escape hatch for any tracker Pixel doesn't cover (LinkedIn Insight, TikTok Pixel, Hotjar, custom server-side gtag).
- **Crisp Chat as the support channel** — Crisp is wired site-wide via `NEXT_PUBLIC_CRISP_WEBSITE_ID`. The codebase deliberately routes every "talk to us" path through [src/lib/crisp.ts](src/lib/crisp.ts)::`openCrispChat()` instead of `mailto:` — pricing checkout-error fallback, the sold-out Repo Only fallback button, the thank-you page "need help" link, and the privacy-policy contact line. `openCrispChat()` is a typed no-op when the widget isn't loaded, so buyers who clone without configuring Crisp see broken-feeling but non-crashing buttons; document the env var prominently in their setup.
- **Founders post-purchase welcome email** *(LeadStack-marketing-specific; `custom` variant buyers can ignore — it only fires on the LeadStack-branded landing's "Founders" Stripe checkout, which the white-label landing doesn't expose)* — when Stripe fires `checkout.session.completed` with `metadata.kind === "founders"`, [src/lib/stripe/webhooks.ts](src/lib/stripe/webhooks.ts)::`handleFoundersCheckout()` pulls `customer_details.email` from the session, writes a `purchases/{sessionId}` doc via `.create()` (atomic — throws on duplicate, which is how the handler de-dupes Stripe retries), then calls [src/lib/stripe/welcome-email.ts](src/lib/stripe/welcome-email.ts)::`sendFoundersWelcomeEmail()` to send the "your access is on the way" email via Resend. Returns early on duplicate (Firestore error code 6 = ALREADY_EXISTS). Email send failures don't throw — they log + leave `welcomeEmailMessageId: null` on the purchase doc so the owner can manually re-send later by inspecting the collection.
- **Landing-page urgency stack (LeadStack variant only)** — the founders pricing card + [src/components/landing/exit-intent-modal.tsx](src/components/landing/exit-intent-modal.tsx) both pull from [src/hooks/use-founders-cohort.ts](src/hooks/use-founders-cohort.ts), which reads real Stripe sales from `appConfig/foundersCohort.soldCount` AND adds `NEXT_PUBLIC_FOUNDERS_MANUAL_SOLD` (build-time inlined) for off-Stripe sales the webhook can't see (Skool, invoiced deals). Result is capped at `slotsTotal`. Bump the env var + redeploy after each off-Stripe sale; Stripe sales accumulate live via the webhook. The exit-intent modal fires once per browser session (sessionStorage gate) after a 10s arm delay when the cursor moves toward the viewport's top edge — skipped entirely on coarse-pointer devices (mobile) and once Wave 1 is sold out.

## Automations (Workflow Recipes v1)

LeadStack ships one named recipe — **Speed-to-Lead** (internal `recipeType: "instant_response"`) — that fires on form submission and sends up to three steps: SMS to lead, email to lead, and a static-recipient owner notification. v2 will add Lead Nurture, Pipeline Stage Trigger, Stale Lead Revive, and Booking Lifecycle (the last via cal.com / Calendly webhook integration).

- **Trigger** — [src/lib/automations/triggers.ts](src/lib/automations/triggers.ts) `fireTriggers()` is called from [src/app/api/forms/[id]/submit/route.ts](src/app/api/forms/[id]/submit/route.ts) after the contact is created. It queries enabled `automations` matching the trigger type + form id, creates an `automation_executions` row per match, and schedules step 0 via QStash.
- **Scheduling** — [src/lib/automations/qstash.ts](src/lib/automations/qstash.ts) wraps `@upstash/qstash`. Each step is a separate QStash message that POSTs `/api/automations/step` after the configured delay. Inbound callbacks verify the `Upstash-Signature` header before running anything; without verification keys configured, the route returns 503.
- **Step executor** — [src/lib/automations/executor.ts](src/lib/automations/executor.ts) loads the execution + automation + contact + template + sub-account + agency owner, runs three pre-flight checks (idempotency via `history`, contact opt-out, send-window), resolves merge tags, sends via Resend or Twilio, appends a history entry + activity row, and either schedules the next step or marks the execution complete. Failures during send are caught and logged to history with `success: false` rather than aborting; QStash 5xx triggers built-in retry.
- **Send-window** — stored on `subAccounts/{id}.sendWindow = { startHour, endHour, timezone }`. The executor checks current time in the configured zone via `Intl.DateTimeFormat`; outside the window, the same step gets republished to QStash with a fresh `nonce` for the next window start.
- **Opt-out compliance** — every email body must include `{{unsubscribeLink}}` (template editor enforces). The link is HMAC-signed (`AUTOMATIONS_TOKEN_SECRET`) and resolves to `/u/[token]` which POSTs `/api/u/[token]` to flip `contact.emailOptedOut = true`. Twilio inbound STOP/START is parsed by `/api/webhooks/twilio/inbound` (signature-verified against `TWILIO_AUTH_TOKEN`); matching contacts (lookup by phone) get `smsOptedOut` flipped. Twilio's webhook URL needs `/api/webhooks/twilio/inbound` configured under the number's "A MESSAGE COMES IN" setting.
- **Idempotency** — QStash retries on 5xx. The executor's first action is `if (execution.history.some(h => h.stepIndex === stepIndex)) return` so retries don't double-send.
- **Local dev** — QStash needs a public callback URL. Run `ngrok http 3000` and set `NEXT_PUBLIC_APP_URL` to the ngrok HTTPS URL while testing automations.

## Bulk email broadcasts (v1)

The contacts page exposes a **Send bulk email** action that fans out a chosen email template to a filtered audience (all contacts / a specific tag / a pipeline stage). Implementation reuses the automations infrastructure — same template engine, same merge tags, same QStash for fan-out, same `{{unsubscribeLink}}` opt-out path.

- **UI**: [src/components/contacts/bulk-email-dialog.tsx](src/components/contacts/bulk-email-dialog.tsx) lets the operator pick template + audience filter and shows a live recipients/skipped preview computed from the loaded contact list. Confirm posts to `/api/broadcasts/email/send` and routes to the broadcast detail page.
- **Send route**: [src/app/api/broadcasts/email/send/route.ts](src/app/api/broadcasts/email/send/route.ts) validates the template (must be type `email`, must contain `{{unsubscribeLink}}`), resolves the audience via [src/lib/broadcasts/audience.ts](src/lib/broadcasts/audience.ts) (pre-skips opted-out + missing-email contacts), creates the `broadcasts/{id}` parent doc + `sends/{contactId}` rows in 500-doc batches, and fans out to QStash with one staggered message per recipient at 5/sec (well under Resend's free-tier 10 req/sec cap). Hard-capped at 25,000 recipients per broadcast.
- **Step executor**: [src/app/api/broadcasts/email/step/route.ts](src/app/api/broadcasts/email/step/route.ts) is the QStash callback. Verifies signature, idempotency-checks the send row (status !== queued → ignore), re-checks `contact.emailOptedOut` live (operator could have flipped it mid-batch), renders merge tags, calls Resend, writes the row's status + atomically increments parent totals. Failed sends are recorded as `status: "failed"` and return 200 — one bounce never retry-storms the batch. The route is in `PUBLIC_PATHS`; security is the QStash signature.
- **List + detail pages**: `/sa/[id]/broadcasts` and `/sa/[id]/broadcasts/[broadcastId]` — onSnapshot-driven, so totals and per-recipient status update live as the fan-out drains.
- **Compliance**: every bulk email goes through the same `validateEmailBody` check that requires `{{unsubscribeLink}}` (CAN-SPAM). Per-recipient unsubscribe links resolve at `/u/[token]`, HMAC-signed with `AUTOMATIONS_TOKEN_SECRET`, flip `contact.emailOptedOut` on click. Pre-flight + live opt-out checks ensure opted-out contacts are never sent.
- **No SMS broadcasts in v1** — bulk SMS needs A2P 10DLC throughput awareness, consent-source audit fields, and TCPA-grade safeguards that are explicitly deferred to Phase 2.

## AI Agents (Web Chat + SMS) v1

A single AI agent powers multiple inbound channels per sub-account. Shipped channels: **Web Chat** (embeddable widget) and **SMS** (inbound auto-replies on the dedicated Twilio number). Voice + Email + Google Business Profile are scaffolded as "coming soon" placeholders.

### Data model — shared profile + per-channel configs

The pre-refactor layout had one combined doc per channel. The current model splits that into:

- **Profile** (`subAccounts/{id}/aiAgent/profile`) — the agent's identity. `systemPrompt`, `businessName`, `hoursStart/End`, `timezone`, `escalationKeywords[]`, `escalationNotifyEmail`. Plus the **website KB** fields: `websiteUrl`, `websiteKb` (markdown snapshot capped at ~6000 chars / ~1500 tokens), `websiteKbFetchedAt`.
- **Per-channel** (`subAccounts/{id}/aiAgent/{channelId}`) — operational toggles. `enabled`, `contextMessageCount`, `modelOverride`, `escalationKeywordsOverride` (null = inherit from profile), `escalationNotifyEmailOverride`, `totalTokensUsed`. The `web-chat` doc nests a `webChat: { allowedDomains, welcomeMessage, accentColor, position }` block; SMS leaves it null.

[src/lib/comms/ai/agent.ts](src/lib/comms/ai/agent.ts) `resolveAgent(subAccountId, channelId)` reads both in parallel and produces a `ResolvedAiAgent` with an `effective` block applying channel overrides. The orchestrators only consume `effective`. Lazy migration: `maybeMigrateLegacy()` runs on every read and silently splits the legacy `aiConfig/main` doc into the new shape one time per sub-account.

### LLM gateway — OpenRouter

[src/lib/comms/ai/openrouter.ts](src/lib/comms/ai/openrouter.ts) `callAi()` POSTs to OpenRouter's OpenAI-compatible chat endpoint. One key (`OPENROUTER_API_KEY`) covers every model the gateway exposes — Anthropic, OpenAI, Google, etc. Default is `anthropic/claude-haiku-4-5` (~$0.005-0.02 per SMS exchange); per-channel override lets premium tiers point at Opus 4.7. Returns `{ text, promptTokens, completionTokens, totalTokens, model }`. The deployment-wide default is `AI_REPLIES_DEFAULT_MODEL` (optional env var, falls back to Haiku).

### System prompt — channel-aware safety rails + KB

[src/lib/comms/ai/prompt.ts](src/lib/comms/ai/prompt.ts) `buildSystemPrompt()` is the single source of truth for the LLM system message. It composes 4 sections: persona (from profile) → channel-specific safety rails → website KB block (when populated) → contact context block (when a contact is identified). Both SMS and Web Chat orchestrators AND the "Test this persona" dry-run endpoint use it, so what you preview matches what the bot actually receives.

Safety rails differ per channel:
- **SMS**: ≤320 chars, no emoji, no markdown, no specific prices/medical/legal commitments.
- **Web Chat**: 1-3 short paragraphs, light markdown allowed, at most one emoji per reply, plus instructions for the `[[form fields="…"]]` and `[[capture …]]` lead-capture markers (see "Lead capture" below).

The KB block tells the model: "Use this as factual reference only — never quote raw markdown or links. Outside this content, fall back to 'let me check with the team'."

### Website KB — Firecrawl

[src/lib/firecrawl/client.ts](src/lib/firecrawl/client.ts) `scrapeUrl(url)` POSTs to `https://api.firecrawl.dev/v1/scrape` with `formats: ["markdown"], onlyMainContent: true`. 30s timeout. Returns markdown + the page title. `POST /api/sub-accounts/[id]/ai-agent/profile/refresh-kb` is admin-only and calls Firecrawl with the profile's saved `websiteUrl`, stores the result (capped at 6000 chars), and stamps `websiteKbFetchedAt`. Failure leaves the previous snapshot intact. The profile route auto-clears the KB whenever `websiteUrl` changes so the bot can't quote a stale site.

Firecrawl is **optional** — the bot works without it, just without homepage factual context. Single-page scrape only in v1; multi-page crawl was considered and rejected for v1 (cost scales fast, signal-to-noise drops). One agency-level key shared across all sub-accounts.

### SMS channel

[src/lib/comms/ai/respond.ts](src/lib/comms/ai/respond.ts) `maybeRespondWithAi()` is the SMS orchestrator. Invoked from [src/app/api/webhooks/twilio/inbound/route.ts](src/app/api/webhooks/twilio/inbound/route.ts) ONLY when the inbound is in dedicated-Twilio mode AND `aiIsConfigured()` AND the resolved agent's `effective.enabled` is true. Pre-flight guards: contact opted-out → skip, empty persona → skip, outside hours → skip, escalation keyword in message → email + skip. Else loads recent message history + the contact context block, builds the system prompt, calls the LLM, sends via Twilio's `sendSmsForSubAccount()`, persists the outbound message + activity row + increments the channel's token counter.

### Web Chat channel — widget + iframe architecture

The widget is a 4KB hand-written vanilla JS loader at [public/widget.js](public/widget.js). The snippet that goes on the client's site is one line (the Web Chat settings page generates it for the operator with the current deployment's URL baked in):

```html
<script src="https://YOUR-DEPLOYMENT-DOMAIN/widget.js" data-sa="sa_xxx" async></script>
```

What the loader does, in order:
1. Reads `data-sa` from its own `<script>` tag and derives the LeadStack origin from its own `src`.
2. `GET /api/web-chat/config?sa=…` to fetch theme + welcome + enabled state. **This** call's Origin header IS the client's site (called from parent-page context), so this is the request the per-sub-account `allowedDomains` allowlist gates. When the origin isn't allowed, the endpoint returns 200 + `{enabled: false}` (no console error) and the loader silently no-ops.
3. Injects a fixed-position floating bubble button using inline styles (no CSS dependencies).
4. On click → lazy-creates an `<iframe src="/embed/chat/[saId]?p=<parentURL>">` and fades it in. The iframe stays in the DOM after close, just hidden via `display:none`, so reopens are instant and preserve state.

The iframe target is a real Next.js page at [src/app/(embed)/embed/chat/[subAccountId]/page.tsx](src/app/(embed)/embed/chat/[subAccountId]/page.tsx) wrapped in a minimal layout that bypasses dashboard chrome. Renders [src/components/web-chat/chat-window.tsx](src/components/web-chat/chat-window.tsx) — fully self-contained with inline styles + a `<style>` block, immune to host-page CSS bleed.

**postMessage** is used in one direction only: iframe → parent for `{type: "close"}` events when the visitor clicks the X. The loader responds by fading the iframe out.

**Cross-origin headers** are configured in [next.config.ts](next.config.ts): `Content-Security-Policy: frame-ancestors *;` on `/embed/*` so any third-party site can iframe it, and `Access-Control-Allow-Origin: *` + a 5-minute cache on `/widget.js`. Both the `/embed/*` route group and `/api/web-chat` are added to `PUBLIC_PATHS` in middleware.

**Crisp-skip:** the root layout's analytics scripts (Crisp, Pixel, GTM) live in [src/components/analytics-scripts.tsx](src/components/analytics-scripts.tsx) which checks `usePathname()` and returns null on `/embed/*`. Without this skip, Crisp's own chat widget would render INSIDE the LeadStack chat iframe — visually broken.

### Web Chat API + security model

Three public endpoints under `/api/web-chat`:
- **`GET /api/web-chat/config?sa=…`** — origin-gated (this is the access control choke-point). Returns theme + welcome.
- **`POST /api/web-chat/message`** — visitor → bot turn. **No origin check** — the iframe is always on LeadStack's domain, so the Origin header would always be our own host, making the check useless. Instead: channel-enabled check, valid sessionId (16-64 char URL-safe regex), 1-2000 char message length, per-IP cap (60/hour) + per-session cap (30 messages) via in-memory LRU in [src/lib/comms/web-chat/rate-limit.ts](src/lib/comms/web-chat/rate-limit.ts), plus the per-channel `totalTokensUsed` counter that caps disaster scenarios. A motivated attacker who scrapes a `data-sa` could call this endpoint directly, but the rate limits + token budget make it uneconomical. If abuse is ever observed, the next step is HMAC-signed tokens issued by `/config` and required by `/message`.
- **`POST /api/web-chat/capture`** — the inline-form submission endpoint (see Lead capture below).

All three respond with CORS headers (`Access-Control-Allow-Origin: *`) so the iframe's fetches never throw a console error.

### Lead capture — two marker mechanisms

The bot can emit one of two markers at the end of its reply when it needs contact details:

**`[[form fields="name,email,phone"]]` (preferred)** — Server strips the marker, returns `formFields` in the `/message` response. Widget renders an inline form below the bot bubble with the requested fields, plus a Skip button. On submit, `POST /api/web-chat/capture` validates email + phone, calls `reconcileContactFromCapture()` (email-match within sub-account wins, otherwise creates a new `source: "web-chat"` Contact), links `session.contactId`, returns a templated thank-you (no extra LLM call), and triggers the follow-up pipeline.

**`[[capture name="…" email="…" phone="…"]]` (fallback)** — Used when the visitor volunteered details in free text without being asked. Bot extracts them, server strips the marker + runs the same reconciliation. No form rendered.

**One-shot enforcement** — Once `session.contactId` is set OR `session.capturePromptShownAt` is stamped, the orchestrator suppresses re-emission server-side (even if the LLM ignores instructions) AND injects a `--- SESSION STATE ---` block into the system prompt telling the model not to ask again.

### Follow-up pipeline on capture

Every successful capture triggers [src/lib/comms/web-chat/follow-up.ts](src/lib/comms/web-chat/follow-up.ts) `createFollowUpActions()`, which is best-effort and never blocks the visitor's thank-you reply:

1. **Task** — creates a row in the `tasks` collection: title `"Follow up with [identity] from Web Chat"`, due end-of-today, `contactId` set, notes carry the captured fields + last visitor message + page URL. The id is stamped onto `session.pendingFollowUpTaskId`.
2. **Email** — sends to `escalationNotifyEmail` (channel override wins, else profile default) via Resend. HTML template with the captured details, latest message blockquote, and CTAs deep-linking to the session detail + contact record. Plain-text fallback included for previews.

Failures are logged + returned in the response's `errors` array but never throw. If the escalation email isn't configured, the Task still creates.

### Operator console

`/sa/[id]/ai-agents/web-chat/sessions` (list) and `/sa/[id]/ai-agents/web-chat/sessions/[sessionId]` (detail). Both subscribe to Firestore via `onSnapshot` so new sessions appear + transcripts update live as visitors chat. The list shows filter pills (All / Pending follow-up / Captured / Anonymous / Escalated) with live counts. Each row subscribes to its linked Task and shows a "Pending follow-up" (amber) or "Followed up" (green) badge that flips automatically when the operator marks the task done. The detail page renders a session header (identity + contact deep-link + page URL + status), a follow-up task card with Mark done / Reopen buttons, and the transcript with visitor / bot / form-submission bubbles distinguished.

Phase 2's operator takeover (operator types into the visitor's widget mid-conversation) is **not** shipped — the console is read-only. Building it would require: an outbound-from-dashboard message endpoint that bypasses the LLM, a "bot silenced" session flag, and onSnapshot listening inside the visitor's iframe.

### Contact source

When a Web Chat capture creates a new Contact, `source: "web-chat"` is stamped. The [src/components/contacts/source-badge.tsx](src/components/contacts/source-badge.tsx) renders this as a violet "Web Chat" pill. Form submissions write `source: "website-form"` (blue), distinct from the legacy `"website"` (sky, used by older contacts + as a manual catch-all in the contact-form dropdown).

## Website builder (gitpage.site v1)

Each sub-account has a singleton website doc at `subAccounts/{id}/website/main`. The page at [my-ghl-app/src/app/(dashboard)/sa/[subAccountId]/website/page.tsx](src/app/(dashboard)/sa/[subAccountId]/website/page.tsx) is a long sectioned form mirroring gitpage's typeform inputs (Basics / Pages / Services / Business / Design / FAQ).

- **Submit**: [src/lib/gitpage/client.ts](src/lib/gitpage/client.ts) `submitBuild()` POSTs to `https://www.gitpage.site/api/v1/generate-site` with `buildType: "local" | "vsl"` (selected by the user via the **Site type** picker on the page) and the agency's `GITPAGE_API_KEY`. Returns 202 + `formResponseId` (prefixed `build_…`). The build route persists `status: "queued"` and the job id, then schedules the first QStash poll. v1 contract is frozen — additions ship into v1, breaking changes land at `/api/v2/`.
- **Build types**: `local` is the multi-page LocalSite (home + optional services/contact/terms). `vsl` is a single-page Video Sales Letter funnel — hero + embedded video + bullets + one CTA. The VSL form drops the Pages/Services/Business sections and shows a Video section instead; `video_link` (any http(s) embed URL — YouTube/Vimeo/Wistia) is required, and `cta_link` is mandatory because the funnel collapses without a destination after the video. Mode is stored on `WebsiteConfig.build_type`; existing docs without it default to `"local"` on read.
- **Polling**: [src/app/api/sub-accounts/[id]/website/poll/route.ts](src/app/api/sub-accounts/[id]/website/poll/route.ts) is a QStash signature-verified callback that hits gitpage's status endpoint every 20s, mirrors the result into Firestore, and reschedules itself until terminal (Published/failed) or the 15-minute cap. The route is in PUBLIC_PATH_PATTERNS in middleware because security comes from the signature, not the session cookie.
- **Field name mapping**: internal types use snake_case (matches the rest of the codebase); the gitpage client transforms to camelCase + flat `pages` array at submit time.
- **Design fields**: dropdowns with gitpage's curated values (see [src/lib/website/gitpage-values.ts](src/lib/website/gitpage-values.ts)). gitpage silently falls back to defaults on unknown values, which would look broken — dropdowns prevent that.
- **Custom palette** requires a 3-hex triple in `customColors`; conditional input appears when `design_color_palette === "Custom"`.
- **Rebuild**: a DELETE to `/api/sub-accounts/[id]/website` resets the doc to `draft` (preserves config, clears jobId/liveUrl/status). The previously-published GitHub repo stays live until manually deleted on gitpage's side — v1 doesn't tear down on rebuild.
- **Auth model**: one `GITPAGE_API_KEY` per agency; shared across all sub-accounts. Each build's `subAccountId` is sent so gitpage tags the build record. Filter all reads/writes by sub-account on our side — gitpage scopes by agency, not sub-account.
- **Rate limit**: gitpage caps at 30 builds/hour/agency. v1 doesn't add a client-side cap; gitpage returns 429 with `resetAt` when exceeded.
- **Heartbeat / subscription gate**: [src/lib/gitpage/heartbeat.ts](src/lib/gitpage/heartbeat.ts) `sendHeartbeat()` POSTs anonymous deployment metadata (instanceId from `system/heartbeat`, owner email, version, sub-account count, builds-last-day, platform) to `POST /api/v1/leadstack/heartbeat`. The response includes `gitpageStatus.agency: boolean` which gets cached at `system/gitpageStatus`. The website-builder UI reads that doc via `onSnapshot` and renders an "activate" banner when `agency === false`. Fired once per cold start via [instrumentation.ts](instrumentation.ts) and once daily via QStash → [/api/cron/gitpage-heartbeat](src/app/api/cron/gitpage-heartbeat/route.ts) (signature-verified). Disable with `GITPAGE_TELEMETRY=off`. To set up the daily schedule: in Upstash QStash dashboard create a schedule pointing at `${NEXT_PUBLIC_APP_URL}/api/cron/gitpage-heartbeat` with cron `0 3 * * *`.

## Commands
- `pnpm dev` — dev server (Turbopack)
- `pnpm build` — production build
- `pnpm start` — production server
- `pnpm lint` — ESLint
- `pnpm format` — Prettier
- `firebase deploy --only firestore:rules` — redeploy rules after any collection change

## Environment Variables

Every single credential is user-provided. Nothing ships embedded. Store in `.env.local` (local) or Vercel env vars (production). See `.env.example` for the template.

### Required for the app to boot
| Var | Source |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Console → Project Settings → Web app config |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | same |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | same |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | same |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | same |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | same |
| `FIREBASE_ADMIN_PROJECT_ID` | Firebase Console → Project Settings → Service accounts → Generate key (JSON) |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | from service account JSON |
| `FIREBASE_ADMIN_PRIVATE_KEY` | from service account JSON (keep as single-line with `\n` escapes, wrapped in double quotes) |
| `COOKIE_SECRET_CURRENT` | `openssl rand -base64 32` |
| `COOKIE_SECRET_PREVIOUS` | same (different value) |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` locally, your production URL in prod |
| `BOOTSTRAP_ADMIN_EMAIL` | The email that's allowed to claim the workspace admin slot on the first signup. Set this BEFORE deploying. Once an admin exists, the var is ignored. |

### Required for billing
| Var | Source |
|---|---|
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe Dashboard → Developers → API keys (test mode for dev) |
| `STRIPE_SECRET_KEY` | same |
| `STRIPE_WEBHOOK_SECRET` | `stripe listen --forward-to localhost:3000/api/webhooks/stripe` prints this |
| `STRIPE_PRO_PRICE_ID` | Stripe Dashboard → Product catalog → create your recurring "Pro" price, copy the `price_...` ID |
| `STRIPE_FOUNDERS_PRICE_ID` | Stripe Dashboard → Product catalog → create your one-time "Founders" price (used by `/api/checkout/founders`), copy the `price_...` ID |

### Required for email (disables cleanly if missing)
| Var | Source |
|---|---|
| `RESEND_API_KEY` | [resend.com](https://resend.com) → API Keys |
| `EMAIL_FROM` | A sender on a Resend-verified domain, e.g. `"LeadStack <notifications@yourdomain.com>"` |

Without these two vars, `/api/comms/email/send` returns **503** and the Email button in the contact profile still renders but the send fails cleanly.

### Required for SMS (disables cleanly if missing)
| Var | Source |
|---|---|
| `TWILIO_ACCOUNT_SID` | [console.twilio.com](https://console.twilio.com) dashboard |
| `TWILIO_AUTH_TOKEN` | same |
| `TWILIO_FROM_NUMBER` | A phone number owned by the Twilio account (trial or purchased) |

Without these three, `/api/comms/sms/send` returns 503. SMS opt-out (STOP/START) also requires the inbound webhook URL configured on the Twilio number — see the Onboarding Guide below.

### Required for automations (disables cleanly if missing)
| Var | Source |
|---|---|
| `QSTASH_URL` | [console.upstash.com](https://console.upstash.com) → QStash → Quickstart panel. **Region-specific** — copy the URL shown for your token's region (EU vs US). Wrong region = signature failures. |
| `QSTASH_TOKEN` | same panel |
| `QSTASH_CURRENT_SIGNING_KEY` | same panel — verifies inbound `Upstash-Signature` headers |
| `QSTASH_NEXT_SIGNING_KEY` | same panel — used during key rotation |
| `AUTOMATIONS_TOKEN_SECRET` | `openssl rand -base64 32`. HMAC-signs unsubscribe links so they can't be forged. Rotating this invalidates all outstanding unsubscribe links. |

Without these, `/api/automations/step` and the website-builder poll route return 503. Automation triggers still fire on form submit (the `automation_executions` row gets created) but step 0 never executes — the form submission itself still works.

### Required for website builder (disables cleanly if missing)
| Var | Source |
|---|---|
| `GITPAGE_API_KEY` | gitpage.site dashboard — agency-level key, format `gp_…`. Shared across all sub-accounts in this deployment. |
| `GITPAGE_API_URL` | Optional. Defaults to `https://www.gitpage.site`. Override only when mocking locally. |

Without `GITPAGE_API_KEY`, `/api/sub-accounts/[id]/website/build` returns 503 and the **Build site** button surfaces a friendly error. The rest of the Website page (form editing) still loads.

### Required for AI Agents (disables cleanly if missing)
| Var | Source |
|---|---|
| `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai) → Keys. One agency-level key covers every model (Anthropic, OpenAI, Google, etc). Required to power the bot replies on Web Chat + SMS channels. |
| `AI_REPLIES_DEFAULT_MODEL` | Optional. OpenRouter model id used when no per-channel override is set. Defaults to `anthropic/claude-haiku-4-5` (best cost/quality balance for SMS-length replies). Override per channel to use `anthropic/claude-opus-4-7` for premium tiers (~50x cost). |

Without `OPENROUTER_API_KEY`, the AI Agents settings UI still renders but every channel stays silent: the SMS inbound webhook short-circuits past `maybeRespondWithAi`, the Web Chat `/api/web-chat/message` endpoint returns the fallback "I had trouble reaching the server" reply, and the `/api/sub-accounts/[id]/ai-agent/test` endpoint returns 503.

### Optional — Firecrawl (powers the website KB on the AI Agent profile)
| Var | Source |
|---|---|
| `FIRECRAWL_API_KEY` | [firecrawl.dev](https://firecrawl.dev) → Dashboard → API Keys, format `fc_…`. One agency-level key shared across all sub-accounts. |

Without this, the AI Agents → Overview page still renders and the agent still works — but the "Refresh KB" button under the website URL field returns 503 with a friendly message. Without a KB the bot can't answer factual questions about the client's services/pricing/etc; it falls back to "let me check with the team and get back to you" for anything outside the persona prompt.

Single-page scrape only (`/v1/scrape` endpoint). The bot's stored snapshot is capped at 6000 chars (~1500 tokens) so it doesn't bloat the prompt on every reply. Re-crawl on demand; stale KB is cleared automatically whenever the operator changes the website URL.

### Required for leads map (disables cleanly if missing)
| Var | Source |
|---|---|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | [account.mapbox.com](https://account.mapbox.com) → Tokens → Create. Free tier covers 50k map loads/month; default public scopes are fine. Public token (starts with `pk.`). |

Without this, the dashboard **Leads map** card renders a "Mapbox not configured" message instead of the map. Form submissions still capture location data (it's stored on the contact regardless) — the data just isn't visualized until you add the token.

Location capture happens server-side in `/api/forms/[id]/submit`: ipapi.co (free tier, 1k/day, no key) gives city + lat/lng; phone country-code parsing (via `libphonenumber-js`) is the fallback for country-level pins. Both fail soft — contacts always save, location fields are just nullable. CSV-imported and manually-created contacts have null location and won't pin on the map (no backfill in v1).

### Required for marketing tracking (all optional, all build-time inlined)
| Var | Source |
|---|---|
| `NEXT_PUBLIC_META_PIXEL_ID` | Meta Events Manager → Data Sources → your Pixel. Numeric ID. When set, the Pixel loads on every page (including hosted forms) and hosted-form submissions auto-fire a `Lead` event client-side. Leave blank to skip. |
| `NEXT_PUBLIC_GTM_ID` | Google Tag Manager → Container ID, format `GTM-XXXXXXX`. When set, GTM loads site-wide (script in body + `<noscript>` iframe). Use this as the escape hatch for any tag Pixel doesn't cover — LinkedIn Insight, TikTok Pixel, Hotjar, custom server-side gtag. |

UTM/fbclid/gclid/referrer/landing-page are captured automatically on every public form submission regardless of whether the Pixel is configured — they're stored on `contact.attribution` for downstream use (Conversions API in Sprint B, campaign reporting later). The hosted form is at `/f/[id]`; the agency only needs to encode UTMs in the iframe `src` if embedding via iframe.

### Required for live chat / support (optional)
| Var | Source |
|---|---|
| `NEXT_PUBLIC_CRISP_WEBSITE_ID` | [app.crisp.chat](https://app.crisp.chat) → Settings → Website Settings → Setup Instructions → Website ID (UUID). |

Without this, the Crisp widget doesn't load and every "chat with us" button (pricing checkout-error fallback, sold-out fallback button, thank-you page support link, privacy-policy contact line) silently no-ops. There's no `mailto:` fallback by design — this codebase doesn't assume you've got a monitored inbox set up at the support email. Either configure Crisp (free tier is fine), pick a different chat widget (Intercom, Tawk.to — swap the script in [src/app/layout.tsx](src/app/layout.tsx)), or replace the `openCrispChat()` calls in [src/lib/crisp.ts](src/lib/crisp.ts) with a route that points at your real support channel (email, contact form, etc).

### Required for landing-page urgency stack (LeadStack variant only, optional)
| Var | Source |
|---|---|
| `NEXT_PUBLIC_FOUNDERS_MANUAL_SOLD` | Count of founders sales closed **outside Stripe** (Skool community, invoiced deals, manual checkouts) that the Stripe webhook can't see. Added on top of the real Stripe count and capped at `slotsTotal`. Bump the value + redeploy after each off-Stripe sale; Stripe sales accumulate automatically via the webhook. |

Blank = no offset. The exit-intent modal + founders progress bar both read through [src/hooks/use-founders-cohort.ts](src/hooks/use-founders-cohort.ts) which applies the offset. Custom landing variant ignores this entirely (no founders cohort UI exists there).

---

## Onboarding Guide (for Claude Code)

When the buyer asks you to help them set up this project, or if they seem new and haven't run the app yet, follow the procedure below. This is designed for buyers who may have never used a terminal before — they purchased LeadStack and just need it running.

### Phase 1: Check Prerequisites

Run these checks automatically and report what's installed vs missing:

1. `git --version` — need 2.30+
2. `node --version` — need 18+
3. `pnpm --version` — install with `npm install -g pnpm` if missing
4. `firebase --version` — install with `npm install -g firebase-tools` if missing
5. `stripe --version` — optional, install with `winget install Stripe.StripeCLI` (Windows) or `brew install stripe/stripe-cli/stripe` (Mac) for local webhook testing
6. `cloudflared --version` (or `ngrok --version`) — optional, only needed to test automations + the website builder locally. Install one of:
   - **Cloudflare Tunnel**: `winget install --id Cloudflare.cloudflared` (Windows) or `brew install cloudflared` (Mac)
   - **ngrok**: `winget install Ngrok.Ngrok` (Windows) or `brew install ngrok/ngrok/ngrok` (Mac)
   - Pick one — see Phase 3.5 for trade-offs. Skip entirely if the user only wants the core CRM.

After installing anything new, remind the user to close and reopen the terminal so PATH updates.

### Phase 2: Install Dependencies

1. Run `pnpm install` from the project root
2. Verify `node_modules` was created

### Phase 2.5: Brand the landing page

The repo ships with `LANDING_VARIANT = "custom"` so the buyer's clone renders a white-label CRM landing at `/`, not the LeadStack marketing page. Before going further, edit [src/config/landing.ts](src/config/landing.ts) and fill in `CUSTOM_BRAND`:

1. Ask the buyer:
   - Business name (used in navbar, hero, footer, page title — everywhere)
   - One-line tagline (used in hero subtitle + meta description)
   - Short description (~140 chars; goes under the hero headline)
   - Support email (used on CTA + FAQ + footer)
   - Primary domain (used in footer, og:url; no `https://`, no trailing slash)
   - Pricing tiers (Starter / Pro / Scale) — name, monthly + annual prices, blurb, feature bullets, CTA label, which one is highlighted

2. Write those into `CUSTOM_BRAND` in `src/config/landing.ts`. Leave `LANDING_VARIANT = "custom"`. (Only flip back to `"leadstack"` if the buyer is running the public LeadStack demo, which is the exception.)

3. Tell the buyer they can re-edit this file anytime — every section reads from `CUSTOM_BRAND` at build time.

If the buyer doesn't want to brand it yet, leave the placeholders in — the page still renders cleanly so they can verify the app boots — but call this out as a TODO before Vercel deploy.

### Phase 3: Configure Environment

1. If `.env.local` does not exist, copy `.env.example` to `.env.local`.
2. Generate cookie secrets automatically and write them to `.env.local`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Run twice — paste results into `COOKIE_SECRET_CURRENT` and `COOKIE_SECRET_PREVIOUS`.
3. Set `NEXT_PUBLIC_APP_URL=http://localhost:3000`.

Then walk through each external service. For each, explain what the user does in the browser and what values to paste back. Write values directly into `.env.local` as they're supplied.

#### Firebase Client SDK
Tell the user:
> Go to https://console.firebase.google.com and create a project (or reuse one).
> Then Project Settings → Your apps → click the web icon (`</>`) and register a web app.
> You'll see a `firebaseConfig` object. Paste the whole object here and I'll extract the values.

When they paste, write into `.env.local`:
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

Then remind them to:
> Enable **Authentication → Sign-in method → Email/Password**.
> Create a **Firestore Database → Start in production mode** (our rules restrict access — test mode isn't needed).

#### Firebase Admin SDK
> Firebase Console → Project Settings → Service accounts → **Generate new private key**. Open the JSON file it downloads and paste the contents here.

Extract and write:
- `FIREBASE_ADMIN_PROJECT_ID` ← from `project_id`
- `FIREBASE_ADMIN_CLIENT_EMAIL` ← from `client_email`
- `FIREBASE_ADMIN_PRIVATE_KEY` ← from `private_key`, wrapped in double quotes in the env file (keep `\n` escapes literal — Node's `replace(/\\n/g, '\n')` unwraps them at runtime).

**Treat the JSON as a secret.** Don't save it in the repo, don't paste it in chat logs that are shared. After you've extracted the three fields, delete the downloaded JSON.

#### Deploy Firestore rules
`.firebaserc` is gitignored (per-developer project alias). On a fresh clone, point the Firebase CLI at the user's project once:
```bash
firebase login                     # only on first setup
firebase use <their-project-id>    # writes .firebaserc locally; do this once per clone
firebase deploy --only firestore:rules
```

`firebase deploy --only firestore:rules` must be re-run whenever new collections are added or rules change. `firebase.json` is committed and shared.

#### Stripe
> Go to https://dashboard.stripe.com — make sure **Test mode** is ON (toggle top-right).
> Developers → API keys. Paste the publishable + secret keys here.

Write:
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`

> Now create your products in Stripe. The shipped checkout helpers reference two price IDs:
> - **Pro Plan** — a recurring price (any amount + interval that matches what the landing's Pro tier advertises). Used by the standard subscription checkout.
> - **Founders** — a one-time price (or a higher-tier upfront option). Used by `/api/checkout/founders`.
> Create whatever products + prices match the buyer's pricing model. Copy each Price ID (starts with `price_`) and paste here.

Write:
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_FOUNDERS_PRICE_ID`

If the buyer only wants one tier for now, they can still set both vars to the same Price ID — `/api/checkout/founders` will just route to the same product. The checkout helpers at `src/lib/stripe/checkout.ts` are easy to rewire once their pricing model is finalized.

Webhook secret (separate terminal):
```bash
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
Copy the `whsec_...` that prints on start. Write to:
- `STRIPE_WEBHOOK_SECRET`

#### Resend (email)
> Go to https://resend.com, sign up, then **Domains → Add Domain**. Add DNS records to your domain's DNS provider, wait for verification (minutes to hours).
> Then **API Keys → Create API Key → Full access**. Paste the key here.

Write:
- `RESEND_API_KEY`
- `EMAIL_FROM` — must be on a verified domain. Example: `"LeadStack <notifications@yourdomain.com>"`.

If the user doesn't own a domain yet, they can still test with Resend's sandbox domain — `EMAIL_FROM="onboarding@resend.dev"` works for test sends but will be flagged as untrusted in production.

#### Twilio (SMS)
> Go to https://console.twilio.com, sign up (free trial gives a phone number + credits).
> From the dashboard, copy **Account SID** and **Auth Token**.
> Under **Phone Numbers → Manage → Active Numbers**, copy your trial or purchased number in E.164 format (`+15551234567`).

Write:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

**Trial-account caveats:** Twilio trial accounts can only send to verified phone numbers and prepend a "Sent from a Twilio trial account" banner. For real usage, upgrade the account and (in the US) register A2P 10DLC.

**Inbound webhook URL (required for STOP/START opt-out):**
Twilio needs to know where to POST when someone replies STOP. After Phase 3.5 (you'll have a public tunnel URL) or Phase 5 (you'll have a Vercel URL), come back here:
> Twilio Console → Phone Numbers → Manage → Active Numbers → click your number.
> Scroll to **Messaging Configuration** → **A MESSAGE COMES IN** → set the URL to `https://your-domain/api/webhooks/twilio/inbound` (HTTP POST). Save.

Without this, your code can still send SMS, but inbound STOP messages never reach the app and `contact.smsOptedOut` won't flip — meaning automations will keep texting people who opted out. Skip if you're not setting up automations.

#### Upstash QStash (Automations + Website polling)
QStash is a managed message queue — it's how scheduled automation steps and website build polling survive Vercel cold starts. Without it, automations can't send delayed steps and website builds sit at "queued" forever.

> Go to https://console.upstash.com, sign up, then **QStash** → the **Quickstart** panel.

**Important — region matters.** The token is bound to a region (EU or US). The dashboard shows the matching URL endpoint above the token. Copy them together:

Write to `.env.local`:
- `QSTASH_URL` — the URL shown next to your token (e.g. `https://qstash.upstash.io` or the EU equivalent). The SDK doesn't auto-resolve this — wrong region = signature verification fails.
- `QSTASH_TOKEN` — from the same panel
- `QSTASH_CURRENT_SIGNING_KEY` — verifies inbound callbacks
- `QSTASH_NEXT_SIGNING_KEY` — for key rotation; needed even if not actively rotating

#### Automations token secret
Used to HMAC-sign unsubscribe links so a malicious actor can't forge one and unsubscribe arbitrary contacts. Generate locally:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Write to `.env.local`:
- `AUTOMATIONS_TOKEN_SECRET` — paste the output

If you ever rotate this, every existing unsubscribe link in inboxes becomes invalid — by design. Old recipients clicking will see a 404.

#### gitpage.site (Website builder)
Each sub-account can publish a marketing site via gitpage.site. One agency-level API key powers all sub-accounts.

> Request your agency API key from gitpage.site (format `gp_<long hex>`).

Write to `.env.local`:
- `GITPAGE_API_KEY` — paste the key
- `GITPAGE_API_URL` — leave unset; the client defaults to `https://www.gitpage.site`. Override only if you're mocking the API locally.

gitpage rate-limits at **30 builds per hour per agency** (shared across all sub-accounts). The build route surfaces 429s as a friendly error to the operator.

#### OpenRouter (AI Agents)
LeadStack uses OpenRouter as the LLM gateway — one key reaches every model (Claude, GPT, Gemini, etc.). Skip this entire section if the buyer doesn't plan to use the AI Agents feature; the rest of the CRM works without it.

> Go to [openrouter.ai](https://openrouter.ai), sign up, deposit at least $5 of credits (Web Chat + SMS bot replies at the Haiku default cost ~$0.005-0.02 per exchange, so $5 covers ~250-1000 conversations). Then **Keys** → **Create API Key**. Paste here.

Write to `.env.local`:
- `OPENROUTER_API_KEY` — paste the key
- `AI_REPLIES_DEFAULT_MODEL` — optional. Leave blank to use Claude Haiku 4.5 (recommended). Override per channel later if you want to test other models.

Without this, the AI Agents settings page still loads but channels stay silent — every channel toggle is rejected with a friendly "Set the persona first" message that's actually masking the missing key.

#### Firecrawl (optional — powers AI Agent website KB)
Skip this if the buyer doesn't care about the bot referencing their clients' actual website content. The bot still works, it just falls back to "let me check with the team" for anything outside the persona prompt.

> Go to [firecrawl.dev](https://firecrawl.dev), sign up. The free tier covers a few hundred scrapes/month which is plenty since each sub-account only refreshes its KB on demand. Then **Dashboard** → **API Keys** → copy the `fc-…` key.

Write to `.env.local`:
- `FIRECRAWL_API_KEY` — paste the key. One agency-level key shared across all sub-accounts.

Once set, the AI Agents → Overview page exposes a "Refresh KB" button next to the website URL field. Clicking it scrapes the homepage (single-page, no crawl) and stores the markdown for the bot to reference.

#### Marketing tracking (Meta Pixel + GTM — optional)
Skip if the buyer doesn't run paid ads or doesn't care about analytics yet. Both vars are `NEXT_PUBLIC_*` so they're inlined at build time — changing them needs a redeploy.

> **Meta Pixel:** [Meta Events Manager](https://business.facebook.com/events_manager) → Data Sources → pick or create the Pixel → copy the numeric ID.
> **Google Tag Manager:** [tagmanager.google.com](https://tagmanager.google.com) → create a container → copy the `GTM-XXXXXXX` ID.

Write to `.env.local`:
- `NEXT_PUBLIC_META_PIXEL_ID` — numeric Pixel ID. When set, the Pixel loads on every page (landing + dashboard + hosted form pages) and form submissions auto-fire a `Lead` event client-side. UTM/fbclid/gclid/referrer/landing-page are stored on the contact regardless.
- `NEXT_PUBLIC_GTM_ID` — `GTM-XXXXXXX`. Use this as the escape hatch for any tracker Meta Pixel doesn't already cover (LinkedIn Insight, TikTok Pixel, Hotjar, custom server-side gtag, etc).

Both are fully optional and ship blank in `.env.example`. Once set, restart `pnpm dev` (env-var change requires a fresh boot in Next.js) — you should see the Pixel + GTM script tags in the page source.

#### Live chat (Crisp — optional but recommended)
LeadStack is wired to route every "talk to us" path through the Crisp widget instead of `mailto:` (pricing checkout-error fallback, the sold-out Repo Only button, thank-you page "need help" link, privacy-policy contact line). Without Crisp configured, those buttons silently no-op — there's no `mailto:` fallback.

> [app.crisp.chat](https://app.crisp.chat) → create a free account → Settings → Website Settings → Setup Instructions → copy the Website ID (a UUID).

Write to `.env.local`:
- `NEXT_PUBLIC_CRISP_WEBSITE_ID` — the UUID.

If the buyer doesn't want Crisp specifically, they can either pick a different chat widget (Intercom, Tawk.to — swap the script in [src/app/layout.tsx](src/app/layout.tsx)) or replace `openCrispChat` calls in [src/lib/crisp.ts](src/lib/crisp.ts) with a `mailto:` or contact-form route they actually monitor.

#### Founders cohort manual offset (LeadStack landing variant only — optional)
Buyers running the white-label `custom` variant can skip this. Only relevant if you're running the LeadStack-branded marketing page with the founders cohort pricing card.

- `NEXT_PUBLIC_FOUNDERS_MANUAL_SOLD` — integer count of founders sales closed **outside Stripe** (Skool community, invoiced deals, manual checkouts). Added on top of the real Stripe-webhook count, capped at `slotsTotal`. Bump + redeploy after each off-Stripe sale.

### Phase 3.5: Local dev tunnel for automations + website polling

QStash needs a public HTTPS URL to call back into your app — `localhost:3000` is unreachable from the public internet. Without a tunnel, automations and website polling won't fire locally. Skip this phase if you're only testing the core CRM (contacts, pipeline, forms without automations, etc.).

You have two options. Both end with you having an HTTPS URL like `https://something.trycloudflare.com` or `https://abc-123.ngrok-free.app`. **Set `NEXT_PUBLIC_APP_URL` in `.env.local` to that URL** — QStash uses it to build callback URLs and the website-poll route reads its own URL from it.

#### Option A: Cloudflare Tunnel (recommended for the test loop)
- **Pros**: free, no signup needed for ad-hoc tunnels; named tunnels survive restarts so a single hostname can be saved into Twilio's webhook config and reused day after day.
- **Cons**: slightly more setup the first time.

Quick start (random hostname, rotates each run — fine for one-off testing):
```bash
cloudflared tunnel --url http://localhost:3000
```

Persistent named tunnel (recommended once you're past one-off testing):
```bash
cloudflared login                                # browser auth, one-time
cloudflared tunnel create leadstack-dev          # creates a tunnel ID
cloudflared tunnel route dns leadstack-dev leadstack-dev.YOUR-DOMAIN.com
cloudflared tunnel --name leadstack-dev --url http://localhost:3000
```
Re-run the last command anytime; the hostname stays the same.

#### Option B: ngrok
- **Pros**: fastest first-run; no account needed for basic use.
- **Cons**: free-tier hostname rotates each restart. Every restart breaks Twilio's saved webhook URL and any QStash callbacks already in flight.

Quick start:
```bash
ngrok http 3000
```
Copy the `https://….ngrok-free.app` URL and paste it into `NEXT_PUBLIC_APP_URL`.

#### After the tunnel is running
Update `.env.local`:
- `NEXT_PUBLIC_APP_URL=https://your-tunnel-hostname.example.com`

Then restart `pnpm dev` so the new value is picked up. Now go back to Twilio (Phase 3) and set the inbound webhook URL to `https://your-tunnel-hostname.example.com/api/webhooks/twilio/inbound`.

### Phase 4: Start the App

1. Run `pnpm dev`.
2. Open http://localhost:3000.
3. Walk through verification:
   - **Landing page** renders at `/` — confirm it shows the buyer's brand (`CUSTOM_BRAND.name` in the navbar + hero, their tagline, their pricing tiers). If you still see "LeadStack" anywhere, double-check `LANDING_VARIANT === "custom"` in `src/config/landing.ts` and that `CUSTOM_BRAND` was filled in.
   - **Theme toggle** switches light/dark.
   - **Signup** at `/signup` creates a user. Check Firebase Console → Authentication that the user appears.
   - **Dashboard** renders at `/dashboard` showing the "Getting Started" empty state.
   - **Add a contact** → it appears in `/contacts`.
   - **Open a deal** on that contact → drag it across pipeline stages.
   - **Create a calendar event** linked to the contact → check the timeline.
   - **Create a form** → copy the public link → submit it in an incognito tab → verify a new contact appears.
   - **Cmd/Ctrl + K** opens global search.
   - **Send email** from the contact profile (requires Resend vars). Verify inbox + blue "Email sent" activity.
   - **Send SMS** from the contact profile (requires Twilio vars). Verify phone + violet "SMS sent" activity.
   - **Upgrade** from `/#pricing` → Stripe checkout with test card `4242 4242 4242 4242`.
   - **Form auto-response** (proves QStash + automations work — needs the tunnel from Phase 3.5):
     - Sub-account → Forms → open or create a form → Automation panel → attach the **Speed-to-Lead** recipe with an SMS step + an email step containing `{{unsubscribeLink}}`.
     - Submit the form in an incognito tab using a real phone + email you can check.
     - SMS arrives within ~10s, email within ~30s. The email's "Unsubscribe" link should resolve and flip `contact.emailOptedOut = true`.
   - **Website build** (proves gitpage works — needs the tunnel from Phase 3.5):
     - Sub-account → Website → click **Sample** to prefill, then **Build site**.
     - Banner flips queued → building. Within 1–3 min you should see a green "Your site is live" banner with a `gitlab.io` or `github.io` URL.
   - **AI Agents → Web Chat** (proves OpenRouter + the widget pipeline work):
     - Sub-account → AI Agents → Overview → save the persona prompt (the default text is fine to start) and the business name. Optional: paste a website URL + click **Refresh KB** to confirm Firecrawl is wired.
     - Switch to the **Web Chat** tab → tick **Enable Web Chat** → set Allowed domains to `localhost` (for this local test) → **Save Web Chat settings**.
     - Copy the snippet and paste it into a tiny `test.html` file: `<html><body>Hello<script src="http://localhost:3000/widget.js" data-sa="..." async></script></body></html>`. Open it in a browser (`file://`) or serve via `python -m http.server 8080`. A bubble appears bottom-right; click → chat opens; send "can someone call me back" — within seconds you should see a real reply (proving OpenRouter works) and an inline form below it (proving the [[form]] marker pipeline works).
     - Fill the form → submit. Check Contacts (a new `source: "web-chat"` row), Tasks (a new "Follow up with…" row due today), and your inbox at the agent profile's escalation email (capture notification).
     - Sessions list lives at AI Agents → Web Chat → **Sessions** (top-right button).

### Phase 5: Deploy to Vercel (when ready)

1. Push to GitHub.
2. On https://vercel.com → Import repository.
3. Add **all** env vars from `.env.local` to Vercel → Project → Settings → Environment Variables. The full set:
   - Firebase client (`NEXT_PUBLIC_FIREBASE_*`) + admin (`FIREBASE_ADMIN_*`)
   - Cookie secrets (`COOKIE_SECRET_CURRENT`, `COOKIE_SECRET_PREVIOUS`)
   - `NEXT_PUBLIC_APP_URL`, `BOOTSTRAP_ADMIN_EMAIL`
   - Stripe (`STRIPE_*`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`)
   - Resend (`RESEND_API_KEY`, `EMAIL_FROM`) and Twilio (`TWILIO_*`)
   - QStash (`QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`) and `AUTOMATIONS_TOKEN_SECRET`
   - gitpage (`GITPAGE_API_KEY`, optionally `GITPAGE_API_URL`)
   - AI Agents: `OPENROUTER_API_KEY` (required for bot replies) + optional `AI_REPLIES_DEFAULT_MODEL`
   - AI Agents KB: optional `FIRECRAWL_API_KEY` (powers the "Refresh KB" button on the agent profile)
4. For `FIREBASE_ADMIN_PRIVATE_KEY`, paste the full key including the `-----BEGIN/END-----` markers. Vercel handles the newlines automatically.
5. Deploy.
6. Update the Stripe webhook endpoint (Stripe dashboard → Webhooks) to point to `https://your-domain.vercel.app/api/webhooks/stripe` and copy the new signing secret into Vercel env vars.
7. Update Twilio's inbound webhook URL (Console → Phone Numbers → Active Numbers → "A MESSAGE COMES IN") to `https://your-domain.vercel.app/api/webhooks/twilio/inbound`. The local-tunnel URL won't be reachable in production.
8. Update `NEXT_PUBLIC_APP_URL` in Vercel env vars to the production URL.
9. Redeploy.
10. **AI Agents Web Chat snippets:** any client sites where the buyer pasted the snippet during local testing point at `http://localhost:3000/widget.js` — those need to be updated to `https://your-domain.vercel.app/widget.js`. Also re-visit each sub-account → AI Agents → Web Chat and update **Allowed domains** to the real hostnames of each client's production site (not `localhost`).

### Troubleshooting Tips

Common issues and fixes:
- **pnpm not found** — `npm install -g pnpm`, restart terminal.
- **Wrong directory** — make sure you're in the folder with `package.json`.
- **Blank page / 500 errors** — `.env.local` likely has a missing or malformed value. Read it; look for empty keys.
- **Auth not working** — in Firebase Console confirm Email/Password provider is enabled.
- **"Permission denied" in Firestore** — `firebase deploy --only firestore:rules` wasn't run, or `.firebaserc` points to the wrong project.
- **Port 3000 in use** — `pnpm dev -- -p 3001`.
- **Private key issues** — `FIREBASE_ADMIN_PRIVATE_KEY` must be in double quotes, with literal `\n` escapes (not real newlines).
- **Stripe webhook not firing** — `stripe listen` needs to be running in a second terminal for local testing.
- **Resend 403 at send time** — the `EMAIL_FROM` address is on a domain that isn't verified in Resend. Check Resend → Domains.
- **Twilio "unverified number" error** — trial accounts can only SMS phones you've verified in Twilio → Phone Numbers → Verified Caller IDs.
- **Comms buttons disabled** — contact has no email or no phone. Edit the contact, add the field, save.
- **Cmd+K doesn't open** — make sure you're on a `/dashboard` / `/contacts` / etc. page (not the public landing page).
- **Form submit succeeds but no SMS/email auto-response** — QStash isn't configured, signing keys mismatch the region, or `NEXT_PUBLIC_APP_URL` doesn't match the public tunnel. Check Vercel/local logs for `/api/automations/step` returning 503 or 401, and verify `QSTASH_URL` matches the region of `QSTASH_TOKEN`.
- **Unsubscribe link returns 404** — `AUTOMATIONS_TOKEN_SECRET` was rotated; old links are invalidated by design. The user has to receive a new email; old ones can't be revived.
- **Twilio STOP not flipping `smsOptedOut`** — Twilio's "A MESSAGE COMES IN" webhook URL isn't pointing at `/api/webhooks/twilio/inbound`, or it points at a stale tunnel hostname after a restart. Refresh the URL in the Twilio console.
- **Website build hangs at "queued"** — the QStash callback can't reach your app. Check `NEXT_PUBLIC_APP_URL` matches the tunnel/Vercel domain, and that the QStash dashboard shows the poll messages with `DELIVERED` status.
- **Website build "ready" but no live URL in the UI** — Firestore rules for the website subcollection weren't deployed. Run `firebase deploy --only firestore:rules`.
- **ngrok hostname keeps rotating** — switch to a named cloudflared tunnel (Phase 3.5 Option A), or upgrade ngrok to a paid plan with a reserved domain.
- **AI Agents channel toggle won't enable** — "Set the persona first" error means `aiAgent/profile.systemPrompt` is empty for that sub-account. Open AI Agents → Overview, fill in the persona prompt (or leave the pre-filled default), click Save profile, then retry the channel toggle.
- **Web Chat widget doesn't render on the client's site** — likely the parent-page hostname isn't in the channel's `webChat.allowedDomains`. The widget loader receives `{enabled: false}` from `/api/web-chat/config` and silently no-ops. Check the browser console for the config response and add the missing hostname under AI Agents → Web Chat → Allowed domains.
- **Web Chat returns "I had trouble reaching the server"** — most often `OPENROUTER_API_KEY` is missing or out of credits; server logs show `[web-chat/respond] LLM call failed`. Also possible: rate limit hit (60/IP/hour or 30/session) — logs return 429 with a Retry-After header.
- **Refresh KB button returns 503** — `FIRECRAWL_API_KEY` isn't set on the deployment. The KB is optional; either set the key or live without site-aware bot context.
- **Refresh KB returns 502 with a Firecrawl error** — usually the URL is paywalled, behind Cloudflare anti-bot, or returned a 404. Try a simpler URL (the bare domain root) or check the site is publicly accessible without JS.
- **Captured a Web Chat lead but no follow-up email arrived** — the agent profile's `escalationNotifyEmail` is blank (or Resend isn't configured). The Task still creates, only the email is skipped. Set the email on AI Agents → Overview → "Default escalation email" or use the per-channel override.
- **Inline capture form doesn't appear after asking for details** — the bot didn't emit the `[[form fields="…"]]` marker. Open AI Agents → Overview → "Test this persona" and ask the same question — if the marker doesn't appear in your test reply, the persona prompt may be overriding the safety-rail instructions (e.g. "always be concise" can suppress markers). Tweak the persona to not contradict the lead-capture instructions.

---

## Voice Port — Stubbed Integration Points

The Voice Agent (Vapi) feature was ported from upstream `leadstack-agency` **decoupled** from three upstream features that voice was built on top of but which were intentionally scoped OUT of this deployment: **territories**, **webhooks**, and the upstream **AI capture/follow-up refactor** (`lib/comms/ai/*`, which on this repo still lives as `lib/comms/web-chat/*`). To keep the port additive and buildable, five integration points are replaced with local **stub modules** that no-op or return safe defaults. Each stub file carries a full TODO header.

Every stub is clearly labeled `⚠️ VOICE-PORT STUB` at the top of its file. **This section is the spec for the next port surfaces** — when territories / webhooks / the AI refactor are ported, swap each stub for the real thing per its TODO and delete the stub.

| # | Stub file | Replaces (upstream owner) | Behavior while stubbed | Feature delta until swapped |
|---|---|---|---|---|
| A | `src/lib/comms/ai/capture.ts` (`reconcileContactFromCapture`) | Upstream AI capture refactor (`lib/comms/ai/capture.ts`); equivalent here is `lib/comms/web-chat/capture.ts` | Logs + returns `null` | Inbound voice calls do NOT auto-create/link a CRM Contact from captured caller details. Outbound calls still resolve via `payload.metaContactId`. |
| B | `src/lib/comms/ai/follow-up.ts` (`createCaptureFollowUp`) | Upstream AI follow-up refactor (`lib/comms/ai/follow-up.ts`); equivalent here is `lib/comms/web-chat/follow-up.ts` | Logs + returns `{taskId:null, emailSent:false, errors:[]}` | Inbound callback requests create no follow-up Task and send no escalation email. (Outbound campaign Tasks are written directly by `end-of-call.ts` and are unaffected.) |
| C | `src/lib/api/webhooks/dispatch.ts` (`emitWebhookEvent`) | Upstream WEBHOOKS feature (`webhookEvents`/`webhookSubscriptions`/`deliveries` collections + routes) | Logs + returns (suppresses) | `voice.call.completed` / `voice.call.captured` outbound webhooks are suppressed. No CRM data lost; only external notifications dropped. |
| D | `src/lib/auth/territory-filter.ts` (`loadEffectiveTerritoryScope`) | Upstream TERRITORIES feature (`territories` collection + routes) | Returns `{enforce:false, ids:null}` (unfiltered) | 🔐 Outbound voice campaigns are NOT territory-scoped. **Mitigated by the V1 gate below** — campaign send is owner/admin-only, so collaborators can't launch an unscoped campaign. |
| E | `src/types/voice-territory-stub.ts` (`GLOBAL_TERRITORY_ID`, re-exported via `@/types`) | Upstream territories types | Constant `"__GLOBAL__"` | Voice campaign follow-up Tasks are stamped with the placeholder territory id. Harmless while territories is absent. |

### 🔐 V1 Outbound-Voice Posture (Posture B — gated)

Because Stub D leaves territory scoping unenforced (audience returns unfiltered), **outbound voice campaign send is gated to sub-account owners/admins** in v1:

- **API:** `api/comms/voice/campaign/send` returns **403** for any caller whose `subAccountRole` is not `agencyOwner` or `admin`.
- **UI:** `components/ai-agents/outbound-voice-section.tsx` renders a notice ("Outbound voice campaigns are available to sub-account owners/admins until territory scoping ships.") instead of the campaign controls for non-admins (`!isAdmin`).
- **Agency gate (separate, also required):** `SubAccountDoc.outboundVoiceEnabledByAgency` must be `=== true` before any outbound call is placed (`api/comms/voice/call`). Defaults to `false`/undefined (explicit allowlist).

**UN-GATE TRIGGER:** when the territories feature is ported and the real `loadEffectiveTerritoryScope` replaces Stub D, remove the owner/admin role check in the campaign send route + restore collaborator access in the UI. Until then, collaborators cannot launch outbound voice campaigns.

**To swap a stub for the real implementation:** port the owning upstream feature (module + its deps + any Firestore collections/rules/routes), then delete the stub file (for E, also remove its `export * from "./voice-territory-stub"` line in `src/types/index.ts`). Re-run `pnpm build` and re-test the affected voice path.

**Also pulled verbatim from upstream as standalone leaf utils (no stubbing needed):** `src/lib/time/window.ts`, `src/lib/contacts/phone-timezone.ts`, `src/lib/client/tasks.ts` (zero internal dependencies each).
