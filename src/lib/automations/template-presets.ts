/**
 * Default template content shipped with every new sub-account.
 *
 * Single source of truth — used by:
 *   - `lib/automations/seed-templates.ts` (server-side seeder, runs at
 *     sub-account creation so every fresh sub-account starts with these
 *     two ready-to-use templates).
 *   - `app/(dashboard)/.../automations/templates/new/page.tsx` (client-side
 *     "Start from a preset" chips on the New Template page, so the operator
 *     can build a third / fourth template from the same starting points).
 *
 * Edit the bodies here and both surfaces update together. Don't copy-paste
 * into either consumer.
 */

import type { StepChannel } from "@/types/automations";

export interface TemplatePreset {
  /** Stable id used by the React key on preset chips. Not persisted. */
  id: string;
  /** Operator-facing label on the chip. Becomes the doc's `name`. */
  label: string;
  /** Tooltip explaining when to pick this preset. */
  description: string;
  type: StepChannel;
  /** Email-only. Empty string for SMS — the doc's `subject` field is null on SMS. */
  subject: string;
  body: string;
}

export const TEMPLATE_PRESETS: ReadonlyArray<TemplatePreset> = [
  {
    id: "welcome-email",
    label: "Welcome email",
    description: "Polite thanks-and-confirmation after a form submit.",
    type: "email",
    subject: "Thanks for getting in touch, {{contact.firstName}}",
    body: `Hi {{contact.firstName}},

Thanks for reaching out to {{workspace.name}} — your message landed and we'll be in touch within 24 hours.

If anything's urgent in the meantime, just reply to this email.

Cheers,
{{owner.firstName}}

—
Don't want emails like this? {{unsubscribeLink}}`,
  },
  {
    id: "welcome-sms",
    label: "Welcome SMS",
    description: "Short reply that sets expectations.",
    type: "sms",
    subject: "",
    body: "Hi {{contact.firstName}}, thanks for reaching out to {{workspace.name}} — we'll be in touch within 24 hours. Reply STOP to opt out.",
  },
  {
    id: "notify-owner-email",
    label: "Notify owner",
    description:
      "Internal email alert when a new lead comes in. Pair with Step 3 of Speed-to-Lead.",
    type: "email",
    subject: "New lead: {{contact.firstName}} {{contact.lastName}}",
    body: `A new lead just submitted a form on {{workspace.name}}.

Name:  {{contact.firstName}} {{contact.lastName}}
Email: {{contact.email}}
Phone: {{contact.phone}}

Reply to them directly at {{contact.email}}, or open the lead in your CRM.

—
{{unsubscribeLink}}`,
  },
  {
    id: "nurture-day2-email",
    label: "Nurture — Day 2 follow-up",
    description: "Gentle check-in 2 days after form submission.",
    type: "email",
    subject: "Just checking in, {{contact.firstName}}",
    body: `Hi {{contact.firstName}},

I wanted to follow up on your inquiry to {{workspace.name}}. Did you have any questions I can help with?

We'd love to help you get started — just reply to this email or give us a call.

Best,
{{owner.firstName}}

—
{{unsubscribeLink}}`,
  },
  {
    id: "nurture-day5-email",
    label: "Nurture — Day 5 value add",
    description: "Share something useful to stay top of mind.",
    type: "email",
    subject: "A quick tip from {{workspace.name}}",
    body: `Hi {{contact.firstName}},

Here's something we share with everyone who reaches out:

[Add a tip, resource, or case study relevant to your business here]

If you'd like to chat about how we can help, I'm here whenever you're ready.

Talk soon,
{{owner.firstName}}

—
{{unsubscribeLink}}`,
  },
  {
    id: "nurture-day10-sms",
    label: "Nurture — Day 10 SMS nudge",
    description: "Short text nudge for leads who haven't responded.",
    type: "sms",
    subject: "",
    body: "Hey {{contact.firstName}}, just circling back from {{workspace.name}}. Still interested in learning more? Happy to chat anytime. Reply STOP to opt out.",
  },
];
