import { GET_LEADS_PARKED } from "@/lib/get-leads/business-types";
import type { AiSuiteKnowledgeCard } from "@/types/ai-suite";

/**
 * Get Leads card — kept out of the live KB while the feature is PARKED so
 * the assistants never describe (or send users hunting for) a surface that
 * isn't in the app. Splices back in automatically when the flag flips.
 */
const GET_LEADS_CARD: AiSuiteKnowledgeCard = {
  id: "get-leads",
  levels: ["sub-account"],
  title: "Get Leads (experimental prospecting)",
  location: "Sidebar → Get Leads",
  keywords: ["get leads", "prospect", "prospecting", "find businesses", "local business", "google maps", "lead finder", "scrape", "no website", "radius", "map", "import leads", "custom service", "tag"],
  body:
    "Get Leads finds local businesses that might need whatever you sell. Pick a business type (a curated list, plus your own — admins click Manage services to add or remove service types), set a location (start typing and pick from the suggestions that appear, or use your current location), a radius, and Max results (10/20/40 — this caps how many businesses come back AND how many enrichment credits one search can spend, so you can't burn credits in a single run), then search — results take 1–3 minutes because each business is enriched with emails and social links. Results show on a map and an enriched list (phone, email, website, rating); amber pins and the 'No website' filter flag businesses without a website. Tick the ones you want, optionally edit the 'Tag as' value (pre-filled from the search, e.g. 'plumbers-brisbane'), and click Import to create contacts (source 'Get Leads' plus that tag; duplicates by phone/email are skipped). Follow up using the tag: a Workflow with the 'contact created' trigger filtered to that tag, a Broadcast to that tag's audience, or an outbound voice campaign over it. Results aren't saved — import before leaving the page. It's experimental and agency-gated: if it shows 'Locked', ask your agency owner to enable it. The deployment also needs an Outscraper API key configured (searches spend the agency's Outscraper credits).",
};

/**
 * The AI Suite knowledge base.
 *
 * Each card is one feature's how-to, grounded in how the app actually
 * behaves. The `title` + `location` are aligned to the real sidebar nav and
 * route tree (`SUB_ACCOUNT_NAV` in components/dashboard/sidebar.tsx and the
 * routes under app/(dashboard)); the `body` is the authoritative content the
 * assistant is allowed to state.
 *
 * This is the "auto-generate from code/UI" source the plan called for, kept
 * as a maintained data file so a future build-time generator can refresh the
 * structural fields (title/location/keywords) from the nav + route tree while
 * the bodies stay reviewable. Add a card when a feature ships; the retriever
 * and prompt pick it up automatically.
 */
export const AI_SUITE_KNOWLEDGE: AiSuiteKnowledgeCard[] = [
  // ─────────────────────────── Sub-account features ───────────────────────
  {
    id: "workspace-assistant",
    levels: ["sub-account", "agency"],
    title: "The assistants (Workspace Assistant & Agency Assistant)",
    location: "Sidebar → Workspace Assistant / Agency → Agency Assistant",
    keywords: ["assistant", "ai suite", "chatbot", "help", "actions", "confirm", "safe", "permissions", "what can you do"],
    body:
      "Two in-app AI assistants: the Workspace Assistant (in each sub-account, scoped strictly to that one workspace's data) and the Agency Assistant (agency owner only — can answer across sub-accounts and act inside a named one). Both answer how-to questions and perform a fixed set of actions; every action shows a confirmation card and nothing runs until you confirm. All executed actions are audit-logged. Both are OFF by default because replies use the agency's AI credits: the agency owner enables the Workspace Assistant per sub-account from the Manage dialog, and the Agency Assistant from Agency → Settings Agency → Agency Assistant.",
  },
  {
    id: "contacts",
    levels: ["sub-account"],
    title: "Contacts",
    location: "Sidebar → Contacts",
    keywords: ["contact", "lead", "people", "import", "csv", "export", "notes", "activity", "tags"],
    body:
      "Contacts holds every lead and customer for the sub-account. Add or edit a contact from the add/edit modal, and open a contact to see its profile with notes and a unified activity timeline. You can import and export contacts as CSV. Contacts carry a source badge (e.g. Web Chat, Booking, Form) showing where they came from, plus captured marketing attribution (UTM/referrer) when they arrived via a public form. The assistant can add a contact (with tags) or search contacts for you.",
  },
  ...(GET_LEADS_PARKED ? [] : [GET_LEADS_CARD]),
  {
    id: "pipeline",
    levels: ["sub-account"],
    title: "Pipeline (Kanban)",
    location: "Sidebar → Pipeline",
    keywords: ["pipeline", "kanban", "deal", "stage", "drag", "won", "lost", "board", "opportunity", "value"],
    body:
      "Pipeline is a drag-and-drop Kanban board with six stages (New → Contacted → Qualified → Proposal → Won / Lost). Each deal card shows its value and days-in-stage. Drag a deal across stages to update it; moving to Lost prompts for a lost reason. One contact can have multiple deals. Accepted quotes can auto-create a Won-stage deal. The assistant can create a deal for a contact, move a deal to another stage (including Won/Lost), and give you a pipeline snapshot with counts and values per stage.",
  },
  {
    id: "calendar",
    levels: ["sub-account"],
    title: "Calendar",
    location: "Sidebar → Calendar",
    keywords: ["calendar", "event", "appointment", "month", "schedule"],
    body:
      "Calendar is a month grid for manual events. Click a day to add an event, optionally link it to a contact, and it writes to the contact's activity timeline. Public self-service booking is handled separately under Booking.",
  },
  {
    id: "booking",
    levels: ["sub-account"],
    title: "Booking pages",
    location: "Sidebar → Booking",
    keywords: ["booking", "calendly", "slot", "appointment", "self-service", "reschedule", "cancel", "reminder"],
    body:
      "Booking is a Calendly-style public slot picker per sub-account. Configure a booking page (durations, working hours, required fields, optional price and reminders), then share its public URL. A visitor picks a slot; the server re-verifies availability, reconciles a contact, creates a calendar event, and sends an ICS-attached confirmation email. Reschedule, cancel, reminders, and paid-hold expiry are handled automatically.",
  },
  {
    id: "tasks",
    levels: ["sub-account"],
    title: "Tasks",
    location: "Sidebar → Tasks",
    keywords: ["task", "todo", "due", "overdue", "follow up", "reminder"],
    body:
      "Tasks organizes todos into Today / Overdue / Upcoming / Done, with a due-today badge in the sidebar. Tasks can be linked to a contact. Several features auto-create follow-up tasks — e.g. a Web Chat or Voice lead capture creates a 'follow up' task due today. The assistant can create a task for you, with a due date and an optional linked contact.",
  },
  {
    id: "forms",
    levels: ["sub-account"],
    title: "Forms",
    location: "Sidebar → Forms",
    keywords: ["form", "builder", "field", "public", "embed", "iframe", "capture", "landing"],
    body:
      "Forms is a drag-order field builder with six field types that map to contact fields. Each form gets a public hosted page and an iframe embed snippet. On submit it auto-creates a contact (and optionally a deal), captures marketing attribution, and can trigger the Speed-to-Lead automation. Attach automations from the form's Automation panel.",
  },
  {
    id: "products",
    levels: ["sub-account"],
    title: "Products catalog",
    location: "Sidebar → Products",
    keywords: ["product", "catalog", "price", "item", "invoice", "line item"],
    body:
      "Products is a reusable per-sub-account catalog (name, description, unit price, currency, active flag). When building a quote or invoice, use 'Add from catalog' to snapshot a product into a line item — editing a product later never changes historical quotes/invoices.",
  },
  {
    id: "quotes-invoices",
    levels: ["sub-account"],
    title: "Quotes & Invoices",
    location: "Sidebar → Quotes",
    keywords: ["quote", "estimate", "invoice", "line item", "accept", "decline", "paid", "paypal", "send"],
    body:
      "Quotes lets you build a line-itemed quote (with discount, tax, terms, validity), send it via a branded email, and the recipient views and accepts or declines on a public page. Accepting can auto-create a Won-stage deal. A quote can be converted to an invoice; invoices can show a PayPal.me 'Pay' button (paste your PayPal.me username under Settings → Payments). Payment is marked paid manually after it lands. Sending requires Resend (email) to be configured.",
  },
  {
    id: "website",
    levels: ["sub-account", "agency"],
    title: "Website builder",
    location: "Sidebar → Website",
    keywords: ["website", "site", "gitpage", "landing", "publish", "build", "vsl", "niche", "template", "like a site", "gym site"],
    body:
      "Website builds a marketing site per sub-account via gitpage.site — fill the sectioned form (Basics / Pages / Services / Design / FAQ), choose Local (multi-page) or VSL (single-page video funnel), optionally pick a niche template (Gym & Fitness, Home Services, Real Estate), and click Build. The build queues and publishes to a live URL in a few minutes. Each sub-account can hold up to 5 sites. The assistant can also build a site for you from a description ('build me a gym website like fitness.com') — it can read a reference site for tone, picks the matching niche template, drafts the copy, and submits the build after you confirm; it can also check whether a build is done. Niche templates need the business's street address. This feature is agency-gated: if the Website entry shows a 'Locked' badge, ask your agency owner to enable it.",
  },
  {
    id: "workflows",
    levels: ["sub-account"],
    title: "Workflows (visual automation builder)",
    location: "Sidebar → Workflows",
    keywords: ["workflow", "automation", "builder", "speed to lead", "trigger", "sms", "email", "drip", "nurture", "publish", "template"],
    body:
      "Workflows is a visual automation builder: pick a trigger (e.g. form submitted, contact created, deal stage changed), then chain steps like send SMS, send email, wait, and create task. Start from a template — Speed-to-Lead, Appointment Confirmation, Lead Nurture, Stage-Change Follow-up — or blank. Workflows are created as drafts; publish to make them live, and check per-run history under the workflow's Runs. Emails must include the unsubscribe link. Delayed steps run through a background queue, so workflows need QStash configured on the deployment. The assistant can create a workflow from a starter template for you (as a draft). Related settings — the Reply-To address, sending-hours window, and the 'Pause all workflows' switch — live under Sidebar → Settings → Sending preferences (Messaging tab), not on the Workflows page.",
  },
  {
    id: "ai-agents",
    levels: ["sub-account"],
    title: "AI Agents",
    location: "Sidebar → AI Agents",
    keywords: ["ai agent", "bot", "web chat", "sms", "whatsapp", "voice", "persona", "channel", "openrouter", "outbound"],
    body:
      "AI Agents is one persona (system prompt + business hours + escalation keywords + optional website knowledge base) that answers across channels. Configure the shared persona on the Overview, then enable channels: Web Chat (an embeddable widget), SMS and WhatsApp (auto-replies on the dedicated Twilio number), and Voice (AI answers inbound calls). Outbound Voice proactively dials contacts. Every channel needs a non-empty persona prompt first, and channels that send need a dedicated Twilio number (Settings → SMS). Note: AI Agents answers your CLIENTS' inbound messages — the Workspace Assistant (this assistant) helps YOU use the app, and is separate.",
  },
  {
    id: "conversations",
    levels: ["sub-account"],
    title: "Conversations (unified inbox)",
    location: "Sidebar → Conversations",
    keywords: ["conversation", "inbox", "message", "reply", "unified", "thread", "chat"],
    body:
      "Conversations is a unified inbox across SMS, WhatsApp, and (when enabled) Facebook/Instagram DMs. Open a thread to read history and reply from the composer; the available send channels depend on what's connected and whether the contact has messaged on that channel. An unread badge appears in the sidebar.",
  },
  {
    id: "broadcasts",
    levels: ["sub-account"],
    title: "Broadcasts (bulk email)",
    location: "Sidebar → Broadcasts",
    keywords: ["broadcast", "bulk", "email", "blast", "campaign", "audience", "send"],
    body:
      "Broadcasts sends an email template to a filtered audience (all contacts, a tag, or a pipeline stage). It reuses the automations engine and every email must include the unsubscribe link. Opted-out and email-less contacts are skipped automatically. Broadcasts is agency-gated — if it shows 'Locked', ask your agency owner to enable it. Bulk SMS is not available.",
  },
  {
    id: "social",
    levels: ["sub-account"],
    title: "Social Planner",
    location: "Sidebar → Social Planner",
    keywords: ["social", "post", "facebook", "instagram", "schedule", "publish", "planner", "meta"],
    body:
      "Social Planner schedules and auto-publishes posts to a connected Facebook Page and Instagram Business account. Compose a caption, paste an image URL, pick Facebook/Instagram targets and a time; posts publish at the scheduled time. It rides the same Facebook/Instagram connection as the inbox (connect it under Settings → Facebook & Instagram). Agency-gated and Meta-only.",
  },
  {
    id: "community",
    levels: ["sub-account"],
    title: "Community & Courses",
    location: "Sidebar → Community",
    keywords: ["community", "course", "group", "skool", "classroom", "member", "feed"],
    body:
      "Community is a Skool-style space with a group feed, a classroom for courses (sections + lessons with YouTube/Vimeo video), leaderboards, and gamification. Groups can be free or paid, open-join or approval-required; members join via magic link and are tied to contacts — share the community's public URL to invite them. It's agency-gated — if 'Locked', ask your agency owner to enable it. The assistant can set up a new free community for you, including its first course and lesson, and give you the live URLs.",
  },
  {
    id: "reports",
    levels: ["sub-account"],
    title: "Reports",
    location: "Sidebar → Reports",
    keywords: ["report", "kpi", "funnel", "revenue", "chart", "analytics", "attribution", "source"],
    body:
      "Reports shows date-range KPIs, a pipeline funnel, a won-revenue chart, and a leads-by-source donut. There's also a revenue-attribution view (first-touch, forms-only) tying revenue back to the source that generated it.",
  },
  {
    id: "sa-settings",
    levels: ["sub-account"],
    title: "Sub-account settings",
    location: "Sidebar → Settings Sub-Account",
    keywords: ["settings", "twilio", "sms", "email domain", "api key", "webhook", "payments", "paypal", "members", "send window"],
    body:
      "Settings is where you configure the sub-account: dedicated Twilio SMS (paste your Account SID, Auth Token, and From number to enable SMS threads + AI channels), a dedicated email sending domain (agency-gated), Sending preferences (Reply-To address, sending-hours window, pause-all-workflows), API keys + webhooks for the public API (agency-gated), PayPal.me for invoice payments, members + invites, and the Facebook & Instagram connection.",
  },
  {
    id: "sending-preferences",
    levels: ["sub-account"],
    title: "Sending preferences (Reply-To, send window, pause workflows)",
    location: "Sidebar → Settings Sub-Account → Sending preferences (Messaging tab)",
    keywords: ["reply-to", "reply to", "replies", "bounce", "send window", "quiet hours", "sending hours", "pause", "pause workflows", "pause automations", "stop workflows", "kill switch"],
    body:
      "The Sending preferences card (Settings → Messaging tab) holds three workspace-wide controls. (1) Reply-To email: replies to every automated and broadcast email route to this address — required before using a dedicated sending domain, because the domain has no inbox and replies to it would bounce. (2) Sending hours: an optional window (start hour, end hour, timezone) so workflow messages outside it wait for the next window start instead of sending overnight. (3) Pause all workflows: an emergency stop — while paused, no workflow triggers fire and in-flight runs stop at their next step; resume from the same card. These used to live on the old Automations settings page; they're in Settings now.",
  },
  {
    id: "api-webhooks",
    levels: ["sub-account"],
    title: "Public API & outbound webhooks",
    location: "Sidebar → Settings Sub-Account → API Keys / Webhooks",
    keywords: ["webhook", "api", "n8n", "make", "zapier", "integration", "endpoint", "trigger", "automation tool", "signing secret", "events", "rest"],
    body:
      "Each sub-account can integrate with external tools two ways. (1) Outbound webhooks: register an endpoint URL (from n8n, Make, Zapier, or custom) plus an event allowlist, and matching events (contact.created, deal.won, form.submitted, quote.accepted, booking.created, message.received, …) get POSTed to it, signed Stripe-style with a per-subscription secret. One webhook covers ONE event category — create one per category. Failed deliveries retry with backoff; 10 straight failures auto-pauses the webhook. (2) REST API: mint keys (lsk_live_/lsk_test_) under API Keys for inbound calls. Both require the agency owner to enable API access for this sub-account (a feature gate). The assistant can set up a webhook for you — just say what should trigger it and give the endpoint URL, and it sends a test event to verify it's live. n8n users: n8n shows two URLs per webhook node — the Test URL (/webhook-test/, only works while the editor is listening) and the Production URL (/webhook/, requires the workflow's Active toggle ON). Use the Production URL for permanent hooks.",
  },
  {
    id: "templates",
    levels: ["sub-account"],
    title: "Templates (email & SMS)",
    location: "Sidebar → Templates",
    keywords: ["template", "email template", "sms template", "merge tag", "unsubscribe", "message", "reusable"],
    body:
      "Templates holds reusable email and SMS message bodies with merge tags (e.g. {{contact.firstName}}) that personalize per recipient. Workflows and Broadcasts pick from these templates when sending. Every email template must include {{unsubscribeLink}} — the editor enforces it for compliance.",
  },
  {
    id: "dashboard",
    levels: ["sub-account"],
    title: "Dashboard",
    location: "Sidebar → Dashboard",
    keywords: ["dashboard", "home", "kpi", "overview", "leads map", "summary", "activity"],
    body:
      "Dashboard is the workspace home: KPI summary, a pipeline snapshot, recent activity, and a leads map with clustered pins showing where contacts came from (locations are captured on public form submissions; the map needs a Mapbox token configured on the deployment).",
  },
  {
    id: "logs",
    levels: ["sub-account"],
    title: "Logs (API & webhook deliveries)",
    location: "Sidebar → Logs",
    keywords: ["logs", "delivery", "webhook log", "api log", "debug", "failed", "retry", "redeliver"],
    body:
      "Logs shows integration history for the workspace: recent public-API requests per key, and outbound webhook events with each delivery attempt (HTTP status, error, retries). Use it to debug an integration — a failing webhook shows the response your endpoint returned, and you can redeliver an event after fixing the endpoint.",
  },
  {
    id: "search",
    levels: ["sub-account"],
    title: "Global search (Cmd/Ctrl+K)",
    location: "Anywhere → press Cmd/Ctrl + K",
    keywords: ["search", "find", "command", "palette", "cmd k", "shortcut"],
    body:
      "Press Cmd+K (Mac) or Ctrl+K (Windows) on any dashboard page to open a global search palette across contacts, deals, tasks, events, and forms.",
  },

  // ───────────────────────────── Agency features ──────────────────────────
  {
    id: "agency-sub-accounts",
    levels: ["agency"],
    title: "Sub-accounts (create & manage)",
    location: "Agency → Sub-accounts",
    keywords: ["sub-account", "subaccount", "create", "client", "workspace", "new", "add", "manage"],
    body:
      "Each client gets a sub-account — an isolated workspace with its own contacts, pipeline, and data. Create one from Agency → Sub-accounts → create; it's assigned a human-readable account number automatically and seeded with default templates. Use the per-row Manage button to rename it, manage members, and control its feature gates. The Agency Assistant can create a sub-account for you, list them with their gates, report a sub-account's record counts and pipeline, and perform workspace actions (contacts, tasks, deals, workflows, webhooks, communities) inside a sub-account you name.",
  },
  {
    id: "agency-feature-gates",
    // Dual-level: sub-account operators hit "why is this Locked?" questions
    // and need to know it's their agency owner who flips the gate.
    levels: ["agency", "sub-account"],
    title: "Feature gates",
    location: "Agency → Sub-accounts → Manage",
    keywords: ["gate", "enable", "disable", "lock", "feature", "permission", "website", "broadcasts", "api", "whatsapp", "social", "community", "assistant"],
    body:
      "Feature gates let the agency owner turn optional features on or off per sub-account — features that consume agency resources (email sending domains, the public API + webhooks, broadcasts, WhatsApp, outbound voice, website builds, Social Planner, Community, Missed-Call Text-Back, and the Workspace Assistant). Every gate is off by default. Open a sub-account's Manage dialog and tick the gates. While a feature is off, its sidebar entry shows a 'Locked' badge (or is hidden if you chose hide-instead-of-lock) and its routes are blocked. Enabling resumes instantly. The Agency Assistant can flip most gates for you (the email sending domain gate must be changed in the Manage dialog because disabling it tears down the live domain). If a sub-account is on a Client billing plan, that plan's gate bundle is applied automatically at activation and whenever the plan is edited — manual gate changes still work, but a plan edit re-applies the bundle.",
  },
  {
    id: "agency-client-billing",
    levels: ["agency"],
    title: "Client billing (plans & subscriptions)",
    location: "Agency → Client billing",
    keywords: ["billing", "charge", "plan", "subscription", "price", "stripe", "checkout", "invoice client", "mrr", "saas mode", "rebill", "comped", "special price", "paywall"],
    body:
      "Client billing lets you charge each sub-account a monthly subscription through your own Stripe account (payments land directly in your Stripe — the platform takes no cut). Create plans at Agency → Client billing: each plan is a name, a monthly price, and the bundle of feature gates it unlocks. Assign a plan from that page's Clients table or from Agency → Sub-accounts → Manage → Billing: the workspace goes 'Awaiting payment' and you can copy or email a secure checkout link (re-sending invalidates older links); the client can also pay from an in-app activation screen. When they pay, the plan's features switch on automatically and renewals bill monthly. You can set a per-client special price, switch plans on a live subscription (prorated), or mark a client 'comped' (not billed — the default for every workspace, so nothing changes until you assign a plan). If a renewal fails the client sees a payment banner for a 7-day grace period, then the workspace pauses behind a paywall until they pay — data is never deleted. The Clients table shows each client's plan, status, and your MRR. Requires Stripe (secret key + webhook) configured on the deployment.",
  },
  {
    id: "workspace-subscription",
    levels: ["sub-account"],
    title: "Your subscription (workspace billing)",
    location: "Sidebar → Settings → Your subscription",
    keywords: ["subscription", "billing", "payment", "card", "invoice", "paywall", "paused", "past due", "update card", "manage billing"],
    body:
      "If your provider bills this workspace as a subscription, Settings shows a 'Your subscription' card with your plan, monthly price, and status. Workspace admins can click 'Manage billing' to update the card or view invoices on Stripe's secure portal, and 'Complete checkout' if payment is still owed. If a renewal payment fails you'll see a warning banner with time to fix the card; after the grace period the workspace pauses behind a payment screen until it's paid — your data is safe and access restores instantly on payment. Pricing and plan changes are handled by your provider (the agency owner).",
  },
  {
    id: "agency-branding",
    levels: ["agency"],
    title: "Agency branding & settings",
    location: "Agency → Settings Agency",
    keywords: ["branding", "logo", "white label", "name", "settings", "billing", "subscription", "app icon", "pwa"],
    body:
      "Agency Settings is where you white-label the product: set the agency name and logo (shown across the sidebar and pages) and, for installable app deployments, the home-screen app icon. Billing (Stripe subscription) is managed here too. The public landing page's brand copy is set separately in the deployment's brand config.",
  },
  {
    id: "pwa-push-notifications",
    levels: ["sub-account", "agency"],
    title: "Mobile app & push notifications",
    location: "Top-right account menu → Your account → Notifications",
    keywords: ["push", "notifications", "notify", "alerts", "mobile app", "install", "pwa", "add to home screen", "home screen", "iphone", "ios", "android", "phone", "speed to lead", "new lead alert", "device", "turn on notifications"],
    body:
      "On installable (custom-branded) deployments the app can be added to a phone's home screen or installed on desktop, and you can turn on push notifications so you're alerted the moment a lead comes in. Notifications are per-user and per-device — each person enables them on each phone or computer they use. To turn them on, open the top-right account menu → Your account → Notifications, allow notifications when the browser prompts, then pick which sub-accounts should notify you. They arrive as that device's normal system notifications — a banner or lock-screen alert in the phone's notification tray, or the computer's notification centre — delivered by the browser even when the CRM isn't open; they are NOT messages that appear inside the CRM, and tapping one opens the app to the relevant item. Because they're per-device, each phone or computer you enable gets its own alert. You'll get a push for a new lead, a new inbound conversation message, a new booking, and a missed call. iPhone and iPad only deliver web push to an app that's been added to the Home Screen (Share → Add to Home Screen), so on iOS install the app first, open it, then enable notifications from that page — the Notifications page shows this hint until you do. If it says notifications aren't configured, the deployment is missing its push keys — that's an agency-owner/setup task (set the VAPID keys NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY and redeploy). The home-screen app icon itself is set separately by the agency owner under Agency → Settings Agency.",
  },
  {
    id: "agency-members",
    levels: ["agency"],
    title: "Members & invites",
    location: "Agency → Sub-accounts → Manage → Members",
    keywords: ["member", "invite", "team", "role", "admin", "collaborator", "access", "remove"],
    body:
      "Add teammates to a sub-account by inviting them from its Manage → Members section. Roles: admin (manages members + settings, full read/write) and collaborator (read/write data, no member management). As agency owner you have implicit admin in every sub-account. Removing a member revokes their access immediately.",
  },
  {
    id: "agency-get-started",
    levels: ["agency"],
    title: "Get started / guided setup",
    location: "Agency → Get started",
    keywords: ["setup", "onboarding", "get started", "guided", "env", "keys", "configure"],
    body:
      "Get started is the first-run onboarding for the agency owner. There's also an optional Guided setup screen where you can enter remaining API keys in-app instead of editing environment variables by hand. Manual setup remains fully supported.",
  },
];
