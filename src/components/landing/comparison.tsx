import { Check, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Cell = "yes" | "partial" | "no" | string;

const rows: { label: string; leadstack: Cell; hubspot: Cell; ghl: Cell }[] = [
  {
    label: "Time to a working client workspace",
    leadstack: "~60 min",
    hubspot: "Days",
    ghl: "2–6 weeks",
  },
  {
    label: "Per-contact pricing tier creep",
    leadstack: "no",
    hubspot: "yes",
    ghl: "no",
  },
  {
    label: "Per-SMS / per-email usage tax on top",
    leadstack: "no",
    hubspot: "partial",
    ghl: "yes",
  },
  {
    label: "Mandatory paid onboarding",
    leadstack: "no",
    hubspot: "yes",
    ghl: "partial",
  },
  {
    label: "Multi-tenant: isolated client workspaces",
    leadstack: "yes",
    hubspot: "no",
    ghl: "yes",
  },
  {
    label: "Step-by-step automation audit log (every send, skip, error)",
    leadstack: "yes",
    hubspot: "partial",
    ghl: "partial",
  },
  {
    label: "Pause every automation in one click",
    leadstack: "yes",
    hubspot: "partial",
    ghl: "no",
  },
  {
    label: "Your brand out of the box",
    leadstack: "yes",
    hubspot: "no",
    ghl: "no",
  },
  {
    label: "Built-in website builder",
    leadstack: "yes",
    hubspot: "partial",
    ghl: "partial",
  },
  {
    label: "You hold the customer data, never us",
    leadstack: "yes",
    hubspot: "no",
    ghl: "no",
  },
  {
    label: "You own everything: data, customers, code, billing",
    leadstack: "yes",
    hubspot: "no",
    ghl: "no",
  },
  {
    label: "Source code you can extend",
    leadstack: "yes",
    hubspot: "no",
    ghl: "no",
  },
];

function Indicator({ value, emphasize }: { value: Cell; emphasize?: boolean }) {
  if (value === "yes") {
    return (
      <span
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-full",
          emphasize
            ? "bg-emerald-500 text-white"
            : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        )}
      >
        <Check className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (value === "no") {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground/60">
        <X className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (value === "partial") {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
        <Minus className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-block text-sm font-medium",
        emphasize ? "text-primary" : "text-foreground",
      )}
    >
      {value}
    </span>
  );
}

export function Comparison() {
  return (
    <section id="comparison" className="bg-muted/30 py-24">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            Why agencies switch
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tighter sm:text-5xl">
            No snapshot tax.{" "}
            <span className="font-serif font-normal italic">
              No SaaS landlord.
            </span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground lg:text-xl">
            GoHighLevel charges $97–$497/mo plus per-message usage. HubSpot
            adds $3K onboarding plus per-contact tiering. UGotLeads is a
            license — own it, host it, brand it.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-2xl border bg-background shadow-sm">
          {/* Header */}
          <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] border-b bg-muted/40 px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-6">
            <div>Feature</div>
            <div className="text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500 bg-clip-text text-sm font-bold text-transparent">
                <span className="inline-block h-2 w-2 rounded-sm bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500" />
                UGotLeads
              </span>
            </div>
            <div className="text-center text-sm text-muted-foreground">
              HubSpot
            </div>
            <div className="text-center text-sm text-muted-foreground">
              GoHighLevel
            </div>
          </div>

          {/* Rows */}
          {rows.map((row, i) => (
            <div
              key={row.label}
              className={cn(
                "grid grid-cols-[1.6fr_1fr_1fr_1fr] items-center gap-2 px-4 py-3 text-sm sm:px-6 lg:text-base",
                i !== rows.length - 1 && "border-b",
              )}
            >
              <div className="pr-2 text-foreground">{row.label}</div>
              <div className="flex justify-center">
                <Indicator value={row.leadstack} emphasize />
              </div>
              <div className="flex justify-center">
                <Indicator value={row.hubspot} />
              </div>
              <div className="flex justify-center">
                <Indicator value={row.ghl} />
              </div>
            </div>
          ))}
        </div>

        {/* Honest cancellation block — what UGotLeads actually replaces vs
            what you keep paying for. Pitched against the GHL-style "I
            cancelled six subscriptions" theme without overclaiming. */}
        <div className="mx-auto mt-12 max-w-4xl">
          <div className="text-center">
            <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">
              What you actually replace
            </h3>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground lg:text-base">
              No inflated math. Here&apos;s the honest line-item breakdown of
              what comes out of your stack — and what stays.
            </p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <ReplaceCard
              kind="cancel"
              title="Cancel"
              subtitle="Replaced in-product"
              items={[
                { name: "CRM", note: "HubSpot / Pipedrive / Close", price: "$15–99/mo" },
                { name: "Form builder", note: "Typeform / Tally / Jotform", price: "$25–29/mo" },
                { name: "Lead-response automation", note: "Zapier / n8n", price: "$20–24/mo" },
                { name: "Multi-client tracking", note: "Airtable / Notion Team", price: "$10/seat/mo" },
                {
                  name: "AI site builder",
                  note: "lovable.dev / v0 / Bolt",
                  price: "$80–100/mo",
                  detail: "Built-in gitpage builder runs at the same $99/mo, except the site is wired to your CRM, forms, and automations out of the box.",
                },
              ]}
              footer="Contacts, pipeline, forms, automations, per-client workspaces, and AI site builds all ship in the box."
            />
            <ReplaceCard
              kind="partial"
              title="Trim"
              subtitle="Partially replaced"
              items={[
                {
                  name: "Email marketing",
                  note: "Mailchimp / ActiveCampaign",
                  price: "$35–149/mo",
                  detail: "Drip + transactional ✓ — newsletter broadcasts to a list ✗",
                },
                {
                  name: "Landing pages",
                  note: "ClickFunnels / Leadpages",
                  price: "$97–127/mo",
                  detail: "Marketing sites ✓ — funnels with upsells / A-B / checkout ✗",
                },
              ]}
              footer="If you only need the basics here, you can cancel. If you run weekly newsletters or upsell funnels, you keep them."
            />
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Typical small agency: ~$50–150/mo cancelled outright, more if
            you also trim the partials. Mileage varies — pick the rows
            that match your stack.
          </p>
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-center text-xs text-muted-foreground">
          Compared against HubSpot Sales Hub Professional and GoHighLevel
          Unlimited, public pricing as of 2026. &ldquo;Per-contact pricing
          tier creep&rdquo; refers to HubSpot&apos;s marketing-contact
          billing. Replacement claims reflect feature parity for typical
          small-agency use; partials are exactly that. Not affiliated with
          either.
        </p>
      </div>
    </section>
  );
}

interface ReplaceItem {
  name: string;
  note: string;
  price: string;
  detail?: string;
}

function ReplaceCard({
  kind,
  title,
  subtitle,
  items,
  footer,
}: {
  kind: "cancel" | "partial";
  title: string;
  subtitle: string;
  items: ReplaceItem[];
  footer: string;
}) {
  const accent =
    kind === "cancel"
      ? {
          ring: "border-emerald-500/30",
          dot: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
          icon: <Check className="h-3.5 w-3.5" />,
          chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        }
      : {
          ring: "border-amber-500/30",
          dot: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
          icon: <Minus className="h-3.5 w-3.5" />,
          chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
        };

  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl border bg-background p-5",
        accent.ring,
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full",
            accent.dot,
          )}
        >
          {accent.icon}
        </span>
        <div>
          <p className="text-base font-semibold tracking-tight">{title}</p>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {subtitle}
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item.name} className="text-sm lg:text-base">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{item.name}</span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  accent.chip,
                )}
              >
                {item.price}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">{item.note}</p>
            {item.detail && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {item.detail}
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-4 border-t pt-3 text-[11px] text-muted-foreground">
        {footer}
      </p>
    </div>
  );
}
