"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface FaqItem {
  question: string;
  answer: ReactNode;
}

const faqs: FaqItem[] = [
  {
    question: "Is there a subscription or trial?",
    answer:
      "No. LeadStack is a one-time purchase: $1,782 for the public license. Founders cohort members lock in $891 across all three waves. You own the code, host it yourself, and get free updates for the version you bought. There's no recurring LeadStack fee. The only ongoing costs are whatever your underlying providers charge — Firebase, Stripe, Resend, Twilio, gitpage — billed directly to you, not through us.",
  },
  {
    question: "Can I rebrand it as my own product?",
    answer:
      "Yes — that's the point. LeadStack is a business in a repo. On setup you swap the logo, brand name, domain, colors, pricing, and email/SMS sender — most of it from a single config file. By the end of week one your customers see your name on every screen, not ours. No \"powered by\" badge, no SaaS landlord taking a margin, and no fork penalty if you ever decide to take it in a different direction.",
  },
  {
    question: "Do I need to know how to code to set this up?",
    answer: (
      <>
        No — there isn&apos;t a single line of code required. Setup is all
        config files, environment variables, and clicking through provider
        dashboards.
      </>
    ),
  },
  {
    question: "Can I host this myself?",
    answer:
      "Yes. Deploy to the host of your choice and plug in your own database, payments, email, SMS, background scheduler, and website-builder accounts — all using your own credentials. You own the data, the source code, and the customer relationships.",
  },
  {
    question: "How is this different from GoHighLevel?",
    answer:
      "GHL is hosted SaaS with snapshots, per-message usage fees, and a 2–6 week onboarding ramp. LeadStack is a production-ready CRM you self-host and brand as your own. Every core feature ships working — contacts, pipeline, forms, automations, website builder, comms — your job between clone and going live is configuration, not building. You bring your own database, payments, email, and SMS providers and pay them directly — no margin tax. There's no snapshot system: every sub-account starts from your codebase, and you extend it however you want.",
  },
  {
    question: "How is this different from HubSpot?",
    answer:
      "HubSpot's Free CRM is a Trojan horse for the upgrade path — Starter is $45/mo, Professional is $890+/mo, plus a $3K mandatory onboarding and per-marketing-contact billing. LeadStack is a flat-priced license, no contact tiers, no onboarding fee. You also get multi-tenant sub-accounts and a built-in website builder, which HubSpot puts in a separate Hub.",
  },
  {
    question: "What does each client see?",
    answer:
      "Each client lives in a sub-account at /sa/[id]/.... They see their own contacts, deals, forms, automations, calendar, tasks, and website. They never see other clients or your agency-level pages. Sub-account admins can invite their own collaborators; the agency owner sees everything.",
  },
  {
    question: "How does the website builder work?",
    answer:
      "It's a built-in gitpage integration. Pick a multi-page marketing site or a single-page video sales letter funnel, fill the form, hit Build — you get a live URL in 1–3 minutes. One agency API key powers every sub-account's sites. Published sites run on GitHub or GitLab Pages. The gitpage agency tier is $99/month, billed directly to gitpage. If you're already paying lovable.dev, v0, or Bolt $80–100/month to build client sites, this is a straight swap at the same price — except the published site is wired to your CRM, forms, and automations out of the box, with no copy-paste integration glue. Founders cohort members get bonus months bundled with their wave: 12 months for True Founders, 6 months for Early Adopters, 3 months for the Final Cohort. The website builder is fully optional — the rest of LeadStack works without it.",
  },
  {
    question: "Can I import my existing contacts?",
    answer:
      "Yes. Drop in a CSV from Sheets, HubSpot, Pipedrive, or anywhere else. The importer fuzzy-matches name / email / phone / company columns automatically; you can map anything else manually.",
  },
  {
    question: "What handles email and SMS?",
    answer:
      "An external email provider for email, an external SMS provider for SMS, and a managed background scheduler for delayed steps. You provide credentials for each — costs go directly to those providers, not through LeadStack. The shared-sender model means replies route back to the agent who sent the message, not to a generic inbox.",
  },
  {
    question: "How is my data kept secure?",
    answer:
      "Security is foundational, not a feature. Because LeadStack is self-hosted, your customer data lives in your own database on your own infrastructure — never pooled with other customers. The single biggest SaaS breach scenario, one shared platform leaking everyone at once, simply doesn't apply. It runs on Google's Firebase (SOC 2 and ISO 27001 certified) with the standard protections you'd expect baked in. And because you get the full source code, you or your security team can verify any of it directly — no black box.",
  },
  {
    question: "What if an automation goes wrong?",
    answer:
      "Two safety rails. First, every execution is logged step by step on a per-sub-account Activity page — channel, recipient, sent/skipped/failed, the exact error string. So you can answer \"did the email go out, why didn't it, what did it actually say\" without opening a database. Second, there's a Pause-all toggle on the Automations page: one click stops new triggers and short-circuits in-flight executions at their next step. Click Resume to bring the engine back. No support ticket, no waiting.",
  },
  {
    question: "Is this a 100% complete app ready to go?",
    answer:
      "Every core feature ships working — LeadStack is a self-hosted CRM you brand as your own, not a turnkey SaaS. Setup is connecting your provider accounts and brand details via config. Before going live, walk the golden path on your own deployment — signup, a contact, a deal, a form, an automation — to confirm it's wired end-to-end. The Onboarding Guide walks Claude Code through everything; plan an afternoon.",
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="py-24">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tighter sm:text-5xl">
            Frequently <span className="font-serif font-normal italic">asked</span>
          </h2>
        </div>

        <div className="mx-auto mt-12 max-w-2xl divide-y">
          {faqs.map(({ question, answer }, index) => (
            <div key={question}>
              <button
                onClick={() =>
                  setOpenIndex(openIndex === index ? null : index)
                }
                className="flex w-full items-center justify-between py-5 text-left text-sm font-medium transition-colors hover:text-primary lg:text-base"
              >
                {question}
                <ChevronDown
                  className={cn(
                    "ml-4 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                    openIndex === index && "rotate-180",
                  )}
                />
              </button>
              <div
                className={cn(
                  "grid transition-all duration-200",
                  openIndex === index
                    ? "grid-rows-[1fr] pb-5"
                    : "grid-rows-[0fr]",
                )}
              >
                <div className="overflow-hidden">
                  <div className="text-sm leading-relaxed text-muted-foreground lg:text-base">
                    {answer}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
