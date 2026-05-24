# Your Agency CRM — Setup Guide

This guide walks you through setting up your CRM instance from a fresh clone to a live deployment. By the end, your white-labeled CRM will be running locally and deployed live to your own infrastructure under your own brand.

**Claude Code handles most of the setup for you.** Once you have VS Code, the Claude Code extension, and the repo cloned (Phase 1), just open the Claude Code chat panel and type `help me set up this project`. It will guide you through the rest — including branding the landing page with your business name, hooking up Firebase, Stripe, Resend, Twilio, Upstash QStash, and gitpage.

The sections below explain what happens at each phase, in case you want to understand the details or troubleshoot.

The repo ships with `LANDING_VARIANT = "custom"` so the homepage renders a white-label CRM landing — your brand, your pricing, your end-customers signing up to you. You'll fill in your business details in Phase 2 below.

---

## Table of Contents

- [Phase 1: Tools & Repo Access](#phase-1-tools--repo-access)
- [Phase 2: Environment Setup & Branding](#phase-2-environment-setup--branding)
- [Phase 3: The Backend (Firebase)](#phase-3-the-backend-firebase)
- [Phase 4: Payments + Comms (Stripe, Resend, Twilio)](#phase-4-payments--comms-stripe-resend-twilio)
- [Phase 5: Automations + Website Builder (QStash, gitpage)](#phase-5-automations--website-builder-qstash-gitpage)
- [Phase 6: Run Locally + Push to Live](#phase-6-run-locally--push-to-live)
- [Troubleshooting](#troubleshooting)

---

## Phase 1: Tools & Repo Access

*Install Tools, Clone, Claude Code*

### Step 1 — Get your repo access

After your LeadStack purchase, you'll be added to the private GitHub repo manually within 24 hours. To make that happen you need a GitHub account.

**1. Create a free GitHub account**

GitHub is where your code lives. You need a free account to receive and store your copy of LeadStack.

Sign up at [github.com](https://github.com)

1. Enter your email address and choose a password
2. Pick a username — this will be public, keep it professional
3. Verify your email when prompted
4. You can skip all the optional setup steps

**2. Send your GitHub username to the LeadStack team**

Once you have your account, reply to your purchase confirmation email (or email `hello@leadstack.io`) with your GitHub username so we can add you to the private repo. You'll get an email invite from GitHub once access is granted — accept it before continuing.

### Step 2 — Install your tools

You need two things: VS Code (your code editor) and Claude Code (your AI coding assistant). Once these are installed, Claude Code will handle everything else.

**1. Install VS Code**

Download it at [code.visualstudio.com](https://code.visualstudio.com)

1. Click **Download for Windows** (or Mac)
2. Run the installer — accept all defaults
3. Open VS Code when it's done

**2. Install the Claude Code extension**

1. In VS Code, click the Extensions icon in the left sidebar (or press `Ctrl+Shift+X`)
2. Search for **Claude Code**
3. Click **Install** on the one by Anthropic
4. You'll need an Anthropic account — create one at [console.anthropic.com](https://console.anthropic.com) if you don't have one
5. Follow the prompts to sign in

**3. Open the project**

1. In VS Code, press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Type **"Clone Git Repository"** and select it
3. Paste the LeadStack repo URL (found on your GitHub profile after accepting the invite)
4. Pick a folder (e.g., Documents) and click **Select as Repository Destination**
5. When prompted, click **Open** to open the project

> **If the clone fails**, make sure you've completed Step 1 and accepted the GitHub invitation from the LeadStack team — then try again.

**4. Let Claude Code set everything up**

1. Open the Claude Code chat panel in VS Code
2. Type:

```
help me set up this project
```

3. Claude Code reads the project's `CLAUDE.md` file and will:
   - Check if Git, Node.js, pnpm, and the Firebase CLI are installed (and install what's missing)
   - Install the project dependencies
   - Create your environment config file
   - **Brand your landing page** — ask for your business name, tagline, pricing tiers, and write them into `src/config/landing.ts`
   - Walk you through setting up Firebase, Stripe, Resend, Twilio, Upstash QStash, and gitpage.site — one at a time
   - Deploy the Firestore security rules to your Firebase project
   - Set up a local tunnel (optional) so automations + the website builder work in dev
   - Start the app when everything's ready

Just follow along — Claude Code will tell you exactly what to do at each step and where to go in your browser. When it asks you to paste something, paste it right into the chat.

---

## Phase 2: Environment Setup & Branding

*Dependencies, Environment Config, Secrets, White-Label Branding*

**What Claude Code does automatically (no input needed):**

- Checks if Git, Node.js, pnpm, and the Firebase CLI are installed — installs what's missing
- Runs `pnpm install` to install project dependencies
- Creates `.env.local` from `.env.example` if it doesn't exist
- Generates two cookie secrets and writes them to `.env.local`
- Generates `AUTOMATIONS_TOKEN_SECRET` (HMAC key for unsubscribe links)
- Sets `NEXT_PUBLIC_APP_URL=http://localhost:3000`

### Brand the landing page (do this first)

The repo ships with `LANDING_VARIANT = "custom"` in `src/config/landing.ts`, which means the homepage at `/` renders a generic white-label CRM landing. Your end-customers will see **your** brand here, not LeadStack's — but only after you fill in `CUSTOM_BRAND`.

Open [src/config/landing.ts](src/config/landing.ts) and edit `CUSTOM_BRAND`:

| Field | What goes here |
|---|---|
| `name` | Your business name. Shows in navbar, hero, footer, page title. |
| `tagline` | One-line positioning. Used in the hero subtitle and `<meta description>`. |
| `shortDescription` | ~140-char product blurb under the hero headline. |
| `supportEmail` | Used on CTA buttons and the FAQ "talk to us" line. |
| `primaryDomain` | Used in footer, og:url, canonical. No `https://`, no trailing slash. |
| `pricing.starter`, `.pro`, `.scale` | Three tiers. Each has `name`, `priceMonthly`, `priceAnnual`, `blurb`, `features[]`, `cta`, `highlighted: boolean`. |

Claude Code will ask for each of these and write them in for you. If you'd rather do it yourself, just edit the file — every section of the landing reads from this config at build time.

Leave `LANDING_VARIANT = "custom"`. Only flip it back to `"leadstack"` if you're forking this to run the public LeadStack demo at leadstack.io.

### All config ends up in `.env.local`

Every value is written into a single file: **`.env.local`**. Nothing is hidden in other config files. If you ever need to check or change a value, that's the only place to look.

**This file is safe and private.** The `.gitignore` ignores all `.env*` files except `.env.example` (which only has empty placeholders). Your keys and secrets will never be committed to GitHub.

### Cookie Secrets

Claude Code generates these automatically. If you ever need to regenerate manually:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Run it twice — one for `COOKIE_SECRET_CURRENT`, one for `COOKIE_SECRET_PREVIOUS`.

---

## Phase 3: The Backend (Firebase)

*Auth + Database + Security Rules*

Claude Code will prompt you for values from Firebase. Here's what you'll do in your browser:

### Create a Firebase Project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Sign in with a Google account
3. Click **"Create a project"** — name it whatever you like (e.g., `leadstack-app`)
4. You can disable Google Analytics (not needed)
5. Click **"Create project"** and wait for it to finish

### Firebase Client Config

Where to find it: Firebase Console > Project Settings (gear icon) > Your apps > Web app

If you haven't registered a web app yet:
1. Click the web icon (`</>`)
2. Enter a nickname (e.g., `leadstack-web`)
3. Skip Firebase Hosting setup
4. Click **Register app**

You'll see a `firebaseConfig` object like this:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

Paste the whole thing to Claude Code. It maps to these `.env.local` values:

| Config key | Env variable |
|-----------|-------------|
| `apiKey` | `NEXT_PUBLIC_FIREBASE_API_KEY` |
| `authDomain` | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` |
| `projectId` | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` |
| `storageBucket` | `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` |
| `messagingSenderId` | `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` |
| `appId` | `NEXT_PUBLIC_FIREBASE_APP_ID` |

### Firebase Admin (Service Account)

Where to find it: Firebase Console > Project Settings > Service accounts > Generate new private key

This downloads a JSON file. Open it and paste the contents to Claude Code. It extracts:

| JSON key | Env variable |
|---------|-------------|
| `project_id` | `FIREBASE_ADMIN_PROJECT_ID` |
| `client_email` | `FIREBASE_ADMIN_CLIENT_EMAIL` |
| `private_key` | `FIREBASE_ADMIN_PRIVATE_KEY` |

**Important:** The private key in `.env.local` must be wrapped in double quotes with `\n` for newlines.

**Treat the JSON as a secret.** After Claude Code has extracted the three fields, delete the downloaded JSON.

### Bootstrap admin email

| Value | Env variable |
|-------|-------------|
| The email YOU will sign up with on first launch | `BOOTSTRAP_ADMIN_EMAIL` |

The first signup that matches this email gets promoted to **agency owner** — a transaction on `appConfig/main` mints the agency, creates a default "Main" sub-account, and writes your owner + admin memberships. Every subsequent signup needs a typed invite (created from the agency dashboard) so a stranger can't claim the agency owner slot during the deploy window. Once an agency owner exists, this env var is ignored.

### Enable Auth & Create Firestore

These are quick toggles in the Firebase Console:

**Authentication:**
1. Click **Authentication** in the sidebar > **Get started**
2. Enable **Email/Password** (toggle on, save)

**Firestore:**
1. Click **Firestore Database** in the sidebar > **Create database**
2. Select **Start in production mode** — LeadStack ships with strict owner-scoped rules we deploy in the next step, so you don't need test mode
3. Pick the closest server location > **Enable**

### Deploy Firestore Security Rules

LeadStack's `firestore.rules` enforces that every user can only read/write their own data. Claude Code will deploy these rules for you after you've connected Firebase:

```bash
firebase login
firebase deploy --only firestore:rules
```

The repo already includes `.firebaserc` and `firebase.json` — Claude Code will update `.firebaserc` to point at your project ID if needed.

> **Rerun `firebase deploy --only firestore:rules` any time you add a new Firestore collection.**

---

## Phase 4: Payments + Comms (Stripe, Resend, Twilio)

*Billing, Email, SMS — your end-customers' send paths*

Claude Code will prompt you for these values next.

### Stripe API Keys

Where to find them: Stripe Dashboard > Developers > API keys (make sure Test mode is ON)

1. Go to [https://dashboard.stripe.com](https://dashboard.stripe.com) and create an account if you haven't
2. Make sure **Test mode** is ON (toggle in the top-right corner)
3. Go to Developers > API keys

| Key | Env variable |
|-----|-------------|
| Publishable key (`pk_test_...`) | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| Secret key (`sk_test_...`) | `STRIPE_SECRET_KEY` |

### Stripe Products & Prices

The shipped checkout helpers reference two price IDs:

- **`STRIPE_PRO_PRICE_ID`** — a recurring subscription price (matches the "Pro" tier shown on your landing page).
- **`STRIPE_FOUNDERS_PRICE_ID`** — a one-time price used by `/api/checkout/founders` for a higher-tier upfront offer.

Create them:

1. Stripe Dashboard > Product catalog > **+ Add product** — create your **Pro** product. Pricing **Recurring**, any amount + interval that matches your landing's Pro tier. Save and copy the Price ID (`price_...`).
2. Repeat for your **Founders** product. Pricing **One-time** (or recurring if you prefer; the route doesn't care). Save and copy the Price ID.

| Value | Env variable |
|-------|-------------|
| Pro recurring Price ID | `STRIPE_PRO_PRICE_ID` |
| Founders Price ID | `STRIPE_FOUNDERS_PRICE_ID` |

If you only have one tier for now, you can point both vars at the same Price ID — the founders checkout will just route to the same product. Rewire `src/lib/stripe/checkout.ts` later if you want a fully custom pricing model.

### Stripe Webhook Secret (for local testing)

1. Open a **separate terminal** (keep your main terminal free)
2. Run `stripe login` — a browser window opens, click **Allow access**
3. Run `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
4. Copy the webhook signing secret (`whsec_...`)

| Value | Env variable |
|-------|-------------|
| Signing secret | `STRIPE_WEBHOOK_SECRET` |

**Keep that terminal running** while testing payments locally.

> **Don't have Stripe CLI?** Claude Code can install it for you, or run `winget install Stripe.StripeCLI` (Windows) and restart your terminal.

### Resend (Email)

LeadStack uses [Resend](https://resend.com) as its email sender. This is the "shared-sender" model — you own the Resend account, your LeadStack users send email from your verified domain, and their email address lands on the `Reply-To:` header so replies bypass LeadStack and go straight to them.

1. Go to [https://resend.com](https://resend.com) and create an account
2. Go to **Domains → Add Domain** and add your sending domain. You'll get a set of DNS records (SPF, DKIM, DMARC) to add at your DNS provider. Verification usually takes a few minutes.
3. Go to **API Keys → Create API Key** and give it Full Access. Copy the key (`re_...`)

| Value | Env variable |
|-------|-------------|
| API key | `RESEND_API_KEY` |
| Verified sender | `EMAIL_FROM` — e.g. `"LeadStack <notifications@yourdomain.com>"` |

**Don't own a domain yet?** You can test with Resend's sandbox: `EMAIL_FROM="onboarding@resend.dev"`. Sandbox sends work for testing but get flagged as untrusted in production.

**Email is optional.** If `RESEND_API_KEY` or `EMAIL_FROM` is missing, the `/api/comms/email/send` route returns a 503 and the **Send email** button on a contact profile surfaces a clean error. The rest of the app works normally.

### Twilio (SMS)

LeadStack uses [Twilio](https://www.twilio.com) for SMS. Same shared-sender model — you own the Twilio account, your users send from your purchased number.

1. Go to [https://console.twilio.com](https://console.twilio.com) and sign up (free trial includes a phone number + credits)
2. From the dashboard, copy your **Account SID** and **Auth Token**
3. Go to **Phone Numbers → Manage → Active Numbers** and copy your trial or purchased number in E.164 format (`+15551234567`)

| Value | Env variable |
|-------|-------------|
| Account SID | `TWILIO_ACCOUNT_SID` |
| Auth Token | `TWILIO_AUTH_TOKEN` |
| Phone number (E.164) | `TWILIO_FROM_NUMBER` |

**Trial account caveats:** Twilio trial accounts can only send SMS to phone numbers you've verified under **Phone Numbers → Verified Caller IDs**, and every message gets prepended with a "Sent from a Twilio trial account" banner. For real usage, upgrade the account and (in the US) register A2P 10DLC.

**SMS is optional.** If any of the three Twilio vars are missing, `/api/comms/sms/send` returns a 503 and the **Send SMS** button fails with a clean error. The rest of the app works normally.

**Per-sub-account Twilio (opt-in).** Beyond the deployment-wide env-var setup above, each sub-account can plug in its own Twilio creds via Settings → SMS. When the toggle is on:

- Outbound sends from that sub-account use its dedicated number (the env-var creds are bypassed for that sub-account).
- Inbound replies are captured into a real-time chat thread on the contact profile (a Messages section that appears below Tasks).
- On save we automatically point the Twilio number's "A MESSAGE COMES IN" webhook at `${NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/inbound`; if that fails (Twilio account permissions, etc.) the settings page shows the URL with a copy button for manual configuration.

The toggle is purely additive — leave it off and existing shared-sender behavior is unchanged. Each sub-account does its own A2P 10DLC registration in its own Twilio account.

### Inbound Twilio webhook (required for STOP/START opt-out)

Twilio needs a public URL to POST to when someone replies STOP. Set this once you have a public URL (a local tunnel in Phase 5 below, or your Vercel URL after Phase 6):

> Twilio Console → Phone Numbers → Manage → Active Numbers → click your number.
> Scroll to **Messaging Configuration → A MESSAGE COMES IN** → set the URL to `https://your-domain/api/webhooks/twilio/inbound` (HTTP POST). Save.

Without this, your code can still send SMS — but inbound STOP messages never reach the app, `contact.smsOptedOut` won't flip, and automations will keep texting opted-out leads. Skip this only if you're not running automations.

### Marketing tracking (Meta Pixel + Google Tag Manager — optional)

Both are pure script-tag installs that fire only when the env var is set. Form submissions on hosted form pages (`/f/[id]`) auto-fire the Meta `Lead` event when the Pixel is configured. UTM/fbclid/gclid/referrer/landing-page are captured on every form submission **regardless** of whether the Pixel is installed — they land on the contact's `attribution` field for downstream use.

**Meta Pixel:**

1. [business.facebook.com/events_manager](https://business.facebook.com/events_manager) → Data Sources → pick or create your Pixel
2. Copy the numeric Pixel ID

| Value | Env variable |
|-------|-------------|
| Pixel ID (numeric) | `NEXT_PUBLIC_META_PIXEL_ID` |

**Google Tag Manager (the escape hatch for everything Pixel doesn't cover — LinkedIn, TikTok, Hotjar, custom server-side gtag):**

1. [tagmanager.google.com](https://tagmanager.google.com) → create a container
2. Copy the container ID (`GTM-XXXXXXX`)

| Value | Env variable |
|-------|-------------|
| Container ID | `NEXT_PUBLIC_GTM_ID` |

**Both vars are `NEXT_PUBLIC_*`** — Next.js inlines them at build time. Setting or changing either requires a dev-server restart locally and a redeploy on Vercel.

### Live chat (Crisp — optional but recommended)

LeadStack is wired so every "talk to us" button in the marketing pages (pricing error fallback, sold-out fallback CTA, thank-you page support link, privacy-policy contact line) opens the Crisp chat widget rather than firing a `mailto:`. Without Crisp configured, those buttons silently no-op — there's no `mailto:` fallback by design.

1. Sign up at [app.crisp.chat](https://app.crisp.chat) (free tier is fine to start)
2. Settings → Website Settings → Setup Instructions → copy the Website ID (UUID format)

| Value | Env variable |
|-------|-------------|
| Website ID | `NEXT_PUBLIC_CRISP_WEBSITE_ID` |

If you'd rather use a different chat tool (Intercom, Tawk.to, etc.), swap the script block in [src/app/layout.tsx](src/app/layout.tsx). If you'd rather use email-only support, edit `openCrispChat` in [src/lib/crisp.ts](src/lib/crisp.ts) to redirect to your `mailto:` instead.

---

## Phase 5: Automations + Website Builder (QStash, gitpage)

*Scheduled message queue + per-sub-account website builder. Both disable cleanly if missing — skip this phase if you only want the core CRM.*

### Upstash QStash

QStash is a managed message queue. It's how the **Speed-to-Lead automation** schedules delayed steps (SMS → wait 60s → email → wait 5m → owner notification) and how the **website builder** polls gitpage for build status without keeping a process alive. Without it: form submissions still work, but no delayed messages get sent; website builds get stuck at "queued".

1. Go to [https://console.upstash.com](https://console.upstash.com) → sign up → **QStash** → the **Quickstart** panel.
2. **Region matters.** Your token is bound to a region (EU or US). The dashboard shows the matching URL endpoint above the token — copy them together. Wrong region = signature verification fails.
3. Copy the values into `.env.local`:

| Value | Env variable |
|-------|-------------|
| Region endpoint (e.g. `https://qstash.upstash.io`) | `QSTASH_URL` |
| Token | `QSTASH_TOKEN` |
| Current signing key | `QSTASH_CURRENT_SIGNING_KEY` |
| Next signing key | `QSTASH_NEXT_SIGNING_KEY` |

Both signing keys are needed even if you're not actively rotating — the verifier checks both.

### Unsubscribe HMAC secret

If Claude Code didn't already generate it in Phase 2:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

| Value | Env variable |
|-------|-------------|
| Random 32-byte base64 | `AUTOMATIONS_TOKEN_SECRET` |

This HMAC-signs unsubscribe links so a malicious actor can't forge a request that unsubscribes arbitrary contacts. **Rotating this value invalidates every outstanding unsubscribe link in inboxes — by design.**

### gitpage.site (website builder)

Each sub-account can publish a marketing site (LocalSite multi-page or single-page VSL funnel) via gitpage.site. One agency-level API key powers all sub-accounts.

1. Request your agency API key from [gitpage.site](https://www.gitpage.site) — Dashboard → API Access → Generate API Key. Format: `gp_<64 hex chars>`.
2. Add to `.env.local`:

| Value | Env variable |
|-------|-------------|
| Agency API key | `GITPAGE_API_KEY` |
| API base URL (optional) | `GITPAGE_API_URL` — leave unset; defaults to `https://www.gitpage.site` |

gitpage rate-limits at **30 builds per hour per agency** (shared across sub-accounts). Builds beyond that surface as a friendly 429 error.

To disable the daily anonymous heartbeat (reports deployment metadata + reads back your subscription status), set `GITPAGE_TELEMETRY=off`.

### Local tunnel (for testing automations + website builds in dev)

QStash and Twilio need a **public HTTPS URL** to call back into your app. `localhost:3000` won't work. Skip this if you only want to test contacts/pipeline/forms-without-automations locally.

Pick one tool:

**Option A — Cloudflare Tunnel (recommended).** Free, no signup for ad-hoc tunnels; named tunnels survive restarts so you can save a stable hostname into Twilio.

```bash
# Ad-hoc (random hostname per run):
cloudflared tunnel --url http://localhost:3000

# Named tunnel (stable hostname, reusable):
cloudflared login
cloudflared tunnel create leadstack-dev
cloudflared tunnel route dns leadstack-dev leadstack-dev.YOUR-DOMAIN.com
cloudflared tunnel --name leadstack-dev --url http://localhost:3000
```

Install: `winget install --id Cloudflare.cloudflared` (Windows) / `brew install cloudflared` (Mac).

**Option B — ngrok.** Fastest first run, but free-tier hostname rotates every restart (breaks Twilio's saved webhook URL and any in-flight QStash callbacks).

```bash
ngrok http 3000
```

Install: `winget install Ngrok.Ngrok` / `brew install ngrok/ngrok/ngrok`.

After the tunnel is running, update `.env.local`:

```
NEXT_PUBLIC_APP_URL=https://your-tunnel-hostname.example.com
```

Restart `pnpm dev` so the new value is picked up. Then return to Phase 4 → Twilio → set the inbound webhook URL to `https://your-tunnel-hostname.example.com/api/webhooks/twilio/inbound`.

---

## Phase 6: Run Locally + Push to Live

*Launch Locally, Verify Everything, Deploy to Vercel*

### Launch Locally

Claude Code will start the dev server for you by running `pnpm dev`. Open [http://localhost:3000](http://localhost:3000) in your browser and verify each feature:

### Verification Checklist

1. **Landing page** — confirm `/` shows **your brand** (the name, tagline, and pricing from `CUSTOM_BRAND`). If you still see "LeadStack" anywhere, double-check `LANDING_VARIANT === "custom"` in `src/config/landing.ts` and that you filled in `CUSTOM_BRAND`
2. **Theme toggle** — sun/moon icon in the navbar switches light/dark
3. **Legal pages** — Terms + Privacy links in the footer load `/terms` and `/privacy`
4. **Sign up as agency owner** — go to `/signup` and use the email you put in `BOOTSTRAP_ADMIN_EMAIL`. You should land on the agency get-started flow and see your agency + a default "Main" sub-account created automatically
5. **Sub-account switcher** — at `/agency` you can see the Main sub-account; click into it to land at `/sa/[id]/dashboard`
6. **Create another sub-account** — `/agency/sub-accounts/new` to spin up a second isolated workspace
7. **Invite a teammate** — sub-account → Settings → Members → invite an email. They get an invite link; accepting creates their user + membership at the role you assigned
8. **Add a contact** — Contacts → Add Contact, fill in name + email + phone
9. **Add a deal** — Pipeline → New Deal, pick the contact, drop into any stage. Drag to **Lost** to see the "Lost reason" prompt
10. **Calendar event** — Calendar → pick a day → create event linked to the contact
11. **Add a task** — Tasks → New Task → link to the contact → due date today (sidebar gets a due-today badge)
12. **Create a form** — Forms → New Form → customize fields → copy public link
13. **Submit the form** — open the public link in an incognito tab → submit → a new contact appears with a `form_submitted` activity
14. **Global search** — `Ctrl/Cmd + K` → type the contact's name → enter
15. **Reports** — Reports → KPIs, funnel, charts populate with the data you just entered
16. **Send email** (needs Resend) — contact profile → Email → send. Inbox should show `Reply-To:` set to your user email
17. **Send SMS** (needs Twilio) — contact profile → SMS → send (to a Twilio-verified number on trial accounts)
18. **CSV export** — Contacts → Export → downloads all contacts
19. **Bulk email** — Contacts → **Send bulk email** → pick a template with `{{unsubscribeLink}}` + audience → confirm. Watch the broadcast detail page update per-recipient live
20. **Form auto-response** (needs QStash + the local tunnel from Phase 5) — Forms → open or create a form → Automation panel → attach the **Speed-to-Lead** recipe with an SMS step + an email step that contains `{{unsubscribeLink}}`. Submit the form in an incognito tab with a real phone + email. SMS arrives in ~10s, email in ~30s. The "Unsubscribe" link should resolve and flip `contact.emailOptedOut = true`
21. **Website builder** (needs gitpage + the local tunnel) — sub-account → Website → click **Sample** to prefill → **Build site**. Banner flips queued → building. Within 1–3 min you should see a green "Your site is live" banner with a `gitlab.io` or `github.io` URL
22. **Stripe checkout** — `/` → click your Pro tier's CTA → test card `4242 4242 4242 4242` (any future date, any CVC)
23. **Marketing tracking** (only if you set `NEXT_PUBLIC_META_PIXEL_ID` or `NEXT_PUBLIC_GTM_ID`) — load the landing page with `?utm_source=test&utm_campaign=verify` appended, submit any form, then open the new contact in your CRM. The `attribution` field should show the UTMs + referrer + landing URL. If the Pixel is set, Meta Events Manager → Test Events should also light up with a `PageView` and a `Lead`
24. **Live chat** (only if you set `NEXT_PUBLIC_CRISP_WEBSITE_ID`) — the Crisp widget should appear bottom-right on every page, and the "talk to us" links in the pricing card / thank-you page / privacy policy should open the Crisp panel

### Deploy to Vercel

When you're ready to go live:

1. Create an account at [https://vercel.com](https://vercel.com) (sign up with GitHub)
2. Click **Add New... > Project** and import your repository
3. Add **all** your `.env.local` variables to the Vercel Environment Variables section. The complete list:
   - Firebase client: `NEXT_PUBLIC_FIREBASE_*` (6 vars)
   - Firebase admin: `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`
   - Cookies: `COOKIE_SECRET_CURRENT`, `COOKIE_SECRET_PREVIOUS`
   - App: `NEXT_PUBLIC_APP_URL` (your Vercel domain), `BOOTSTRAP_ADMIN_EMAIL`
   - Stripe: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (regenerated for production — see below), `STRIPE_PRO_PRICE_ID`, `STRIPE_FOUNDERS_PRICE_ID`
   - Resend: `RESEND_API_KEY`, `EMAIL_FROM`
   - Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
   - QStash: `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`
   - Automations: `AUTOMATIONS_TOKEN_SECRET`
   - gitpage: `GITPAGE_API_KEY` (and optionally `GITPAGE_API_URL` if mocking)
   - Tracking (optional): `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_GTM_ID`
   - Chat (optional): `NEXT_PUBLIC_CRISP_WEBSITE_ID`
   - Leads map (optional): `NEXT_PUBLIC_MAPBOX_TOKEN`
   - Founders urgency (LeadStack-variant only, optional): `NEXT_PUBLIC_FOUNDERS_MANUAL_SOLD`
4. For `FIREBASE_ADMIN_PRIVATE_KEY` on Vercel, paste the full key including the `-----BEGIN/END PRIVATE KEY-----` markers. Vercel handles the newlines automatically
5. Change `NEXT_PUBLIC_APP_URL` to your Vercel domain (e.g., `https://my-app.vercel.app`) — QStash and gitpage callbacks read this to build their callback URLs
6. Click **Deploy**

**For production Stripe webhooks:**
1. Stripe Dashboard > Developers > Webhooks > **Add endpoint**
2. URL: `https://your-app.vercel.app/api/webhooks/stripe`
3. Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
4. Copy the new signing secret and update `STRIPE_WEBHOOK_SECRET` in Vercel

**For production Resend:**
- Make sure your sending domain is fully verified in Resend (sandbox `onboarding@resend.dev` is test-only)

**For production Twilio:**
- Upgrade from trial if you want to send to non-verified numbers
- In the US, register A2P 10DLC through the Twilio console to avoid carrier filtering
- Update the inbound webhook URL on your number to `https://your-app.vercel.app/api/webhooks/twilio/inbound` (the local-tunnel URL won't be reachable in production)

**For production QStash + automations:**
- No additional setup beyond env vars — automations + the website builder will use your Vercel URL automatically (via `NEXT_PUBLIC_APP_URL`)
- Optional: schedule the daily gitpage heartbeat. In the Upstash QStash dashboard, create a schedule that POSTs to `https://your-app.vercel.app/api/cron/gitpage-heartbeat` with cron `0 3 * * *` (or whatever time you prefer). The route is signature-verified, so don't expose the schedule's secret URL

**For production gitpage:**
- No additional setup — your `GITPAGE_API_KEY` works the same in production. Builds are agency-scoped on gitpage's side

If everything works locally and on Vercel, you're done! Your CRM is fully set up under your own brand. From here, extend it for your business — tune the landing copy, add the integrations or workflows your clients need, or build new Speed-to-Lead-style automation recipes.

---

## Troubleshooting

### Prerequisites

| Problem | Solution |
|---------|----------|
| `pnpm: command not found` | Run `npm install -g pnpm`, then restart your terminal |
| `git: command not found` | Install Git from https://git-scm.com/download/win, restart VS Code |
| `node: command not found` | Install Node.js LTS from https://nodejs.org, restart VS Code |
| `firebase: command not found` | Run `npm install -g firebase-tools`, restart your terminal |
| `stripe: command not found` | Run `winget install Stripe.StripeCLI`, restart terminal |

### Running the App

| Problem | Solution |
|---------|----------|
| `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` | You're in the wrong folder. `cd` to the folder with `package.json` |
| `Module not found: Can't resolve ...` | Run `pnpm install` again |
| Blank page or console errors | Check `.env.local` — make sure every value is filled in |
| Port 3000 already in use | Run `pnpm dev -- -p 3001` |

### Firebase

| Problem | Solution |
|---------|----------|
| Auth not working | Check that Email/Password is enabled in Firebase Console |
| `FIREBASE_ADMIN_PRIVATE_KEY` errors | Make sure the value is wrapped in double quotes in `.env.local` and the `\n` escapes are literal |
| `Missing or insufficient permissions` | The Firestore rules haven't been deployed. Run `firebase deploy --only firestore:rules` — and rerun this any time a new collection is added |
| `firebase deploy` says "no project" | Edit `.firebaserc` so `"default"` matches your Firebase project ID, then retry |

### Stripe

| Problem | Solution |
|---------|----------|
| Checkout not redirecting | Verify all 4 Stripe env vars are filled in and correct |
| Webhooks not received locally | Make sure `stripe listen` is running in a separate terminal |
| `openssl` not recognized | Use `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` instead |

### Email (Resend)

| Problem | Solution |
|---------|----------|
| "Email is not configured on this deployment" (503) | `RESEND_API_KEY` or `EMAIL_FROM` is missing from `.env.local`. Restart the dev server after adding them |
| Resend returns 403 at send time | Your `EMAIL_FROM` address is on a domain that isn't verified in Resend. Go to Resend → Domains and finish the DNS verification |
| Email sent but not received | Check the recipient's spam folder. For production, add SPF/DKIM/DMARC DNS records correctly |

### SMS (Twilio)

| Problem | Solution |
|---------|----------|
| "SMS is not configured on this deployment" (503) | One of `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` is missing. Restart after adding them |
| "The number +1... is unverified" | Trial Twilio accounts can only SMS numbers you've verified in Twilio → Phone Numbers → Verified Caller IDs |
| Messages show "Sent from a Twilio trial account" | That's the trial banner — upgrade your Twilio account to remove it |
| US SMS silently dropped | Register A2P 10DLC through the Twilio console — required for US long-code SMS |

### Global Search / Comms UI

| Problem | Solution |
|---------|----------|
| `Ctrl/Cmd + K` doesn't open anything | You need to be on a sub-account page (any `/sa/[id]/...` route), not the public landing page |
| Send email / SMS buttons are greyed out | The contact doesn't have an email or phone saved. Click **Edit** on the contact, add the missing field |

### Landing page

| Problem | Solution |
|---------|----------|
| Landing page still shows "LeadStack" branding | Confirm `LANDING_VARIANT === "custom"` in `src/config/landing.ts`, then fill in `CUSTOM_BRAND` and reload |
| Pricing tier shows "$0" or placeholder | `CUSTOM_BRAND.pricing.{starter,pro,scale}` still has the placeholder values — edit `src/config/landing.ts` |
| Footer shows the wrong domain | Update `CUSTOM_BRAND.primaryDomain` (no `https://`, no trailing slash) |

### Automations (QStash)

| Problem | Solution |
|---------|----------|
| Form submits but no SMS/email auto-response fires | Check the local tunnel is running and `NEXT_PUBLIC_APP_URL` matches the tunnel hostname; restart `pnpm dev` after changing it. Check `/api/automations/step` logs for 503 (missing QStash env vars) or 401 (signature mismatch — usually wrong region) |
| QStash signature verification fails | Most common cause: `QSTASH_URL` region doesn't match the token's region. The dashboard shows the matching URL above your token |
| Unsubscribe link returns 404 | `AUTOMATIONS_TOKEN_SECRET` was rotated — old links are invalidated by design. The contact has to receive a new email |
| Twilio STOP not flipping `smsOptedOut` | Twilio's "A MESSAGE COMES IN" URL isn't pointing at `/api/webhooks/twilio/inbound`, or points at a stale tunnel hostname after restart. Refresh in the Twilio console |

### Website builder (gitpage.site)

| Problem | Solution |
|---------|----------|
| **Build site** button surfaces 503 | `GITPAGE_API_KEY` is missing. Add it and restart |
| Build hangs at "queued" forever | QStash callback can't reach your app. Verify `NEXT_PUBLIC_APP_URL` matches your tunnel/Vercel hostname, and check the QStash dashboard for poll messages with `DELIVERED` status |
| Build says "ready" but no live URL in the UI | Firestore rules for the website subcollection weren't deployed — run `firebase deploy --only firestore:rules` |
| 429 rate-limited error on build | You've exceeded gitpage's 30 builds/hour/agency cap. Wait it out — the error includes `resetAt` |
| Activate banner won't go away | Your gitpage agency subscription is inactive. Activate it from the gitpage dashboard, then click the **Refresh** button in the website builder header (or wait for the next daily heartbeat) |

### Marketing tracking + chat

| Problem | Solution |
|---------|----------|
| Meta Pixel / GTM env var set but nothing fires | `NEXT_PUBLIC_*` vars inline at build time — restart `pnpm dev` locally, redeploy on Vercel. Confirm the script tag appears in the page source after restart |
| UTMs not appearing on new contacts | Make sure the form was submitted from a URL that actually carried UTM params (`/f/[id]?utm_source=...`). For iframe embeds, the UTMs must be in the iframe `src` — cross-origin policy blocks reading the host page's URL |
| Pixel `Lead` event doesn't fire | Meta Pixel only loads when `NEXT_PUBLIC_META_PIXEL_ID` is set. Use Meta's Pixel Helper browser extension to debug — it shows what events actually fire and what's blocked |
| Crisp widget doesn't appear | `NEXT_PUBLIC_CRISP_WEBSITE_ID` is missing or wrong. The Website ID is a UUID — get it from Settings → Website Settings → Setup Instructions |
| "Talk to us" / "chat with us" buttons do nothing | Crisp isn't configured. Either set `NEXT_PUBLIC_CRISP_WEBSITE_ID` or edit `openCrispChat` in [src/lib/crisp.ts](src/lib/crisp.ts) to redirect to your contact channel |
| Founders bar shows 0 sales despite `NEXT_PUBLIC_FOUNDERS_MANUAL_SOLD=N` | Restart `pnpm dev` locally / redeploy on Vercel. `NEXT_PUBLIC_*` is build-time only |
