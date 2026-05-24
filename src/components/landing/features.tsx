import {
  Building2,
  Globe,
  GitBranch,
  Shield,
  Workflow,
  Mail,
  ServerCog,
  CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function Features() {
  return (
    <section id="features" className="bg-muted/30 py-24">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            What&apos;s in the box
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tighter sm:text-5xl">
            Everything an agency needs.{" "}
            <span className="font-serif font-normal italic">Nothing it doesn&apos;t.</span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground lg:text-xl">
            Built ground-up for the agency-multi-client pattern — not bolted
            on as an afterthought. Every feature scopes to a sub-account by
            design, enforced at the database layer.
          </p>
        </div>

        <div className="mx-auto mt-14 grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-6 md:grid-rows-[auto_auto_auto]">
          {/* Multi-tenant — the headline architectural feature */}
          <BentoCard className="md:col-span-4 md:row-span-1">
            <div className="flex h-full flex-col justify-between gap-6 p-6 sm:p-8">
              <div>
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/20">
                  <Building2 className="h-5 w-5" />
                </div>
                <h3 className="text-xl font-semibold tracking-tight">
                  Multi-tenant by default
                </h3>
                <p className="mt-2 max-w-md text-sm text-muted-foreground lg:text-base">
                  Agency → sub-accounts → members. Each client&apos;s contacts,
                  deals, forms, automations, and website live in their own
                  workspace. Built so clients never see each other — the
                  database makes sure of it.
                </p>
              </div>
              <div className="space-y-2">
                {[
                  {
                    name: "Acme Plumbing",
                    accountNumber: "1001",
                    tag: "Pipeline live",
                    tone: "bg-emerald-500/10 text-emerald-700",
                  },
                  {
                    name: "BrightLab Coffee",
                    accountNumber: "1002",
                    tag: "Site published",
                    tone: "bg-blue-500/10 text-blue-700",
                  },
                  {
                    name: "Atlas Home Services",
                    accountNumber: "1003",
                    tag: "Automation firing",
                    tone: "bg-amber-500/10 text-amber-700",
                  },
                ].map((r) => (
                  <div
                    key={r.accountNumber}
                    className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2 text-xs shadow-sm backdrop-blur"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium">{r.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        #{r.accountNumber}
                      </span>
                    </div>
                    <span className={cn("rounded-full px-2 py-0.5", r.tone)}>
                      {r.tag}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </BentoCard>

          {/* Website builder */}
          <BentoCard className="md:col-span-2 md:row-span-1">
            <div className="relative flex h-full flex-col justify-between gap-6 p-6">
              <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gradient-to-br from-emerald-500/30 to-teal-500/30 blur-3xl" />
              <div>
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20">
                  <Globe className="h-5 w-5" />
                </div>
                <h3 className="text-xl font-semibold tracking-tight">
                  Sites + VSL funnels, included
                </h3>
                <p className="mt-2 text-sm text-muted-foreground lg:text-base">
                  Build a multi-page marketing site or single-page video
                  sales letter for any client. Push the button, get a live
                  URL in 1–3 minutes.
                </p>
              </div>
              <div className="rounded-lg border bg-background/80 p-3 text-[11px] shadow-sm backdrop-blur">
                <div className="mb-1 flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                  <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Site live
                </div>
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  acme-plumbing-2026-05-06.gitlab.io
                </p>
              </div>
            </div>
          </BentoCard>

          {/* Pipeline */}
          <BentoCard className="md:col-span-2 md:row-span-1">
            <div className="flex h-full flex-col gap-4 p-6">
              <div>
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/20">
                  <GitBranch className="h-5 w-5" />
                </div>
                <h3 className="text-xl font-semibold tracking-tight">
                  Pipelines that stay in sync
                </h3>
                <p className="mt-2 text-sm text-muted-foreground lg:text-base">
                  Six-stage Kanban with drag-drop. Real-time updates across
                  every seat in the sub-account.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {["New", "Qualified", "Won"].map((s, i) => (
                  <div key={s} className="space-y-1">
                    <div className="rounded-sm bg-muted px-1.5 py-0.5 text-center text-[9px] font-medium">
                      {s}
                    </div>
                    <div className="h-6 rounded-sm border bg-background" />
                    {i !== 2 && <div className="h-6 rounded-sm border bg-background" />}
                  </div>
                ))}
              </div>
            </div>
          </BentoCard>

          {/* Automations — front and centre */}
          <BentoCard className="md:col-span-2 md:row-span-1">
            <div className="flex h-full flex-col gap-4 p-6">
              <div>
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/20">
                  <Workflow className="h-5 w-5" />
                </div>
                <h3 className="text-xl font-semibold tracking-tight">
                  Speed-to-Lead — with the receipts
                </h3>
                <p className="mt-2 text-sm text-muted-foreground lg:text-base">
                  Form submit → SMS + email + owner notify, in seconds. Every
                  send is logged step-by-step — channel, recipient, error if
                  any. One toggle pauses the whole engine if something goes
                  sideways.
                </p>
              </div>
              <div className="grid gap-1.5 rounded-lg border bg-background p-2 text-[10px]">
                <div className="flex items-center gap-1.5">
                  <span className="rounded-sm bg-indigo-500/10 px-1.5 py-0.5 font-medium text-indigo-700 dark:text-indigo-400">
                    Form submit
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="rounded-sm bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">
                    SMS + Email
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="rounded-sm bg-violet-500/10 px-1.5 py-0.5 font-medium text-violet-700 dark:text-violet-400">
                    Audit log
                  </span>
                </div>
                <p className="text-muted-foreground">
                  Pause-all switch. Per-step history. No black box.
                </p>
              </div>
            </div>
          </BentoCard>

          {/* Compliance — the unsexy but critical one */}
          <BentoCard className="md:col-span-2 md:row-span-1">
            <div className="flex h-full flex-col gap-4 p-6">
              <div>
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 to-rose-500 text-white shadow-lg shadow-pink-500/20">
                  <Shield className="h-5 w-5" />
                </div>
                <h3 className="text-xl font-semibold tracking-tight">
                  Compliance baked in
                </h3>
                <p className="mt-2 text-sm text-muted-foreground lg:text-base">
                  Unsubscribes work. STOP works. Quiet hours work. You don&apos;t
                  think about it, you don&apos;t get fined.
                </p>
              </div>
              <div className="space-y-1 rounded-lg border bg-background p-2 text-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Unsubscribe</span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    Auto-handled
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">SMS STOP</span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    Auto opt-out
                  </span>
                </div>
              </div>
            </div>
          </BentoCard>

          {/* Row 3: three smaller */}
          <BentoCard className="md:col-span-2 md:row-span-1">
            <div className="p-6">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
                <Mail className="h-5 w-5" />
              </div>
              <h3 className="text-base font-semibold">
                Replies hit the right inbox
              </h3>
              <p className="mt-1.5 text-sm text-muted-foreground lg:text-base">
                Replies skip the shared inbox and go straight to the agent
                who sent the message. No more &ldquo;who&apos;s handling
                this?&rdquo;
              </p>
            </div>
          </BentoCard>

          <BentoCard className="md:col-span-2 md:row-span-1">
            <div className="p-6">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600">
                <ServerCog className="h-5 w-5" />
              </div>
              <h3 className="text-base font-semibold">Yours, not rented</h3>
              <p className="mt-1.5 text-sm text-muted-foreground lg:text-base">
                Your domain, your billing, your customer list. All yours, all
                the time — no vendor lock-in, no SaaS landlord taking a cut.
              </p>
            </div>
          </BentoCard>

          <BentoCard className="md:col-span-2 md:row-span-1">
            <div className="p-6">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
                <CalendarClock className="h-5 w-5" />
              </div>
              <h3 className="text-base font-semibold">Calendar + tasks</h3>
              <p className="mt-1.5 text-sm text-muted-foreground lg:text-base">
                Month-grid events linked to contacts, due-today task badge,
                everything threaded into the activity timeline.
              </p>
            </div>
          </BentoCard>
        </div>
      </div>
    </section>
  );
}

function BentoCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-background/60 backdrop-blur-sm transition-all hover:border-primary/30 hover:shadow-md",
        className,
      )}
    >
      {children}
    </div>
  );
}
