import {
  Bell,
  CheckCircle2,
  FileText,
  GitBranch,
  Globe,
  Mail,
  MessageSquare,
  Sparkles,
  Workflow,
} from "lucide-react";

/**
 * Workspace tour — four mock surfaces in pure HTML/CSS so they stay
 * theme-aware and don't need image assets. Goal is to show, not tell:
 * the visitor sees what each surface actually looks like before signup.
 */
export function WorkspaceTour() {
  return (
    <section id="tour" className="py-24">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            Inside a sub-account
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tighter sm:text-5xl">
            Every client gets the{" "}
            <span className="font-serif font-normal italic">whole stack</span>.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground lg:text-xl">
            Pipeline, forms, automations, website — one private workspace
            per client. No add-on tax, no app marketplace.
          </p>
        </div>

        <div className="mx-auto mt-14 grid max-w-6xl gap-4 lg:grid-cols-2">
          <PipelineMock />
          <FormBuilderMock />
          <AutomationMock />
          <WebsiteMock />
        </div>
      </div>
    </section>
  );
}

function MockFrame({
  url,
  title,
  description,
  icon: Icon,
  tone,
  children,
}: {
  url: string;
  title: string;
  description: string;
  icon: typeof GitBranch;
  tone: "indigo" | "violet" | "emerald" | "amber";
  children: React.ReactNode;
}) {
  const toneClass = TONE[tone];
  return (
    <article className="overflow-hidden rounded-2xl border bg-card">
      <header className="border-b p-5">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneClass.bg} ${toneClass.text}`}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
      </header>
      <div className="bg-muted/30 p-4">
        <div className="overflow-hidden rounded-lg border bg-background">
          <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
            <div className="flex gap-1">
              <div className="h-2 w-2 rounded-full bg-red-400/60" />
              <div className="h-2 w-2 rounded-full bg-amber-400/60" />
              <div className="h-2 w-2 rounded-full bg-emerald-400/60" />
            </div>
            <span className="ml-2 truncate text-[10px] text-muted-foreground">
              {url}
            </span>
          </div>
          <div className="p-3">{children}</div>
        </div>
      </div>
    </article>
  );
}

const TONE: Record<
  "indigo" | "violet" | "emerald" | "amber",
  { bg: string; text: string }
> = {
  indigo: {
    bg: "bg-indigo-500/10",
    text: "text-indigo-600 dark:text-indigo-400",
  },
  violet: {
    bg: "bg-violet-500/10",
    text: "text-violet-600 dark:text-violet-400",
  },
  emerald: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  amber: {
    bg: "bg-amber-500/10",
    text: "text-amber-600 dark:text-amber-400",
  },
};

function PipelineMock() {
  const stages = [
    {
      label: "New",
      tone: "bg-slate-500/10",
      cards: [
        { name: "Sarah Chen · Acme", value: "$3.2k" },
        { name: "Marcus Patel", value: "$1.8k" },
      ],
    },
    {
      label: "Qualified",
      tone: "bg-indigo-500/10",
      cards: [{ name: "Elena Rossi", value: "$5k" }],
    },
    {
      label: "Won",
      tone: "bg-emerald-500/10",
      cards: [
        { name: "Jordan Reyes", value: "$2.4k" },
        { name: "Priya Sharma", value: "$8k" },
      ],
    },
  ];

  return (
    <MockFrame
      url="/sa/1001/pipeline"
      title="Pipeline / Kanban"
      description="Drag deals across stages, lost-reason prompt on Lost, real-time multi-seat sync."
      icon={GitBranch}
      tone="indigo"
    >
      <div className="grid grid-cols-3 gap-2">
        {stages.map((s) => (
          <div key={s.label} className="space-y-1.5">
            <div
              className={`rounded-md px-2 py-1 text-center text-[10px] font-medium ${s.tone}`}
            >
              {s.label}
            </div>
            {s.cards.map((c) => (
              <div
                key={c.name}
                className="rounded-md border bg-background p-2 text-[10px]"
              >
                <p className="truncate font-medium">{c.name}</p>
                <p className="mt-0.5 text-muted-foreground">{c.value}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </MockFrame>
  );
}

function FormBuilderMock() {
  return (
    <MockFrame
      url="/sa/1001/forms/lead-capture"
      title="Form builder + embed"
      description="Drag-order fields, six types, public hosted page + iframe with theme/accent controls."
      icon={FileText}
      tone="violet"
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-[10px]">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-blue-500/10 text-blue-600">
            @
          </span>
          <span className="flex-1 font-medium">Email</span>
          <span className="rounded-full bg-pink-500/10 px-1.5 text-[9px] text-pink-600">
            Required
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-[10px]">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-emerald-500/10 text-emerald-600">
            ☎
          </span>
          <span className="flex-1 font-medium">Phone</span>
        </div>
        <div className="flex items-center gap-2 rounded-md border-2 border-dashed border-violet-500/40 bg-violet-500/5 px-2 py-1.5 text-[10px]">
          <Sparkles className="h-3 w-3 text-violet-500" />
          <span className="flex-1 text-muted-foreground">
            Embed appearance: light theme, accent #7c3aed
          </span>
        </div>
        <div className="flex items-center justify-between rounded-md border border-violet-500/30 bg-violet-500/5 px-2.5 py-1.5 text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-violet-500/15 text-violet-600 dark:text-violet-400">
              <FileText className="h-2 w-2" />
            </span>
            <span className="font-medium">Embed snippet ready</span>
          </div>
          <span className="rounded-md bg-violet-500 px-1.5 py-0.5 text-[9px] font-medium text-white">
            Copy
          </span>
        </div>
      </div>
    </MockFrame>
  );
}

function AutomationMock() {
  return (
    <MockFrame
      url="/sa/1001/automations"
      title="Automations · Speed-to-Lead"
      description="Form submit fires SMS + email + owner notify. Send-window + opt-out compliance built in."
      icon={Workflow}
      tone="amber"
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-[10px]">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-indigo-500/10 text-indigo-600">
            <FileText className="h-2.5 w-2.5" />
          </span>
          <span className="flex-1 font-medium">Trigger: Form submitted</span>
        </div>
        <div className="ml-4 border-l border-dashed border-foreground/15 pl-3">
          <div className="space-y-1.5">
            <Step
              icon={MessageSquare}
              label="Send SMS to lead"
              detail="Immediate · template merge tags"
              tone="emerald"
              done
            />
            <Step
              icon={Mail}
              label="Send Email to lead"
              detail="Immediate · with unsubscribe link"
              tone="violet"
              done
            />
            <Step
              icon={Bell}
              label="Notify owner"
              detail="After 1 min · static recipient"
              tone="pink"
            />
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5 rounded-md bg-emerald-500/5 px-2 py-1 text-[10px] text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          <span>STOP and unsubscribe handled automatically</span>
        </div>
      </div>
    </MockFrame>
  );
}

function Step({
  icon: Icon,
  label,
  detail,
  tone,
  done,
}: {
  icon: typeof Mail;
  label: string;
  detail: string;
  tone: "emerald" | "violet" | "pink";
  done?: boolean;
}) {
  const t = TONE[tone === "pink" ? "amber" : tone];
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-[10px]">
      <span
        className={`flex h-4 w-4 items-center justify-center rounded ${t.bg} ${t.text}`}
      >
        <Icon className="h-2.5 w-2.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{label}</p>
        <p className="truncate text-[9px] text-muted-foreground">{detail}</p>
      </div>
      {done && (
        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
      )}
    </div>
  );
}

function WebsiteMock() {
  return (
    <MockFrame
      url="/sa/1001/website"
      title="Website builder"
      description="Sectioned form, async build, live URL in 1–3 minutes. One site per sub-account."
      icon={Globe}
      tone="emerald"
    >
      <div className="space-y-2">
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium">Your site is live</p>
              <p className="truncate font-mono text-[9px] text-emerald-700 dark:text-emerald-400">
                acme-plumbing-2026-05-06.gitlab.io
              </p>
            </div>
            <span className="rounded-md bg-primary px-1.5 py-0.5 text-[9px] font-medium text-primary-foreground">
              Visit
            </span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-[9px]">
          <div className="rounded-md border bg-background p-2">
            <p className="font-medium">Heading</p>
            <p className="mt-0.5 truncate text-muted-foreground">
              Acme Plumbing
            </p>
          </div>
          <div className="rounded-md border bg-background p-2">
            <p className="font-medium">Pages</p>
            <p className="mt-0.5 text-muted-foreground">4 selected</p>
          </div>
          <div className="rounded-md border bg-background p-2">
            <p className="font-medium">Build</p>
            <p className="mt-0.5 text-emerald-600 dark:text-emerald-400">
              ready · 12 polls
            </p>
          </div>
        </div>
      </div>
    </MockFrame>
  );
}
