import {
  Building2,
  FileText,
  Globe,
  Sparkles,
  Wand2,
  type LucideIcon,
} from "lucide-react";

interface Step {
  minute: string;
  title: string;
  description: string;
  icon: LucideIcon;
  tone: "indigo" | "violet" | "pink" | "emerald" | "amber";
}

const steps: Step[] = [
  {
    minute: "0:00",
    title: "You're up and running",
    description:
      "Workspace live in minutes. Plug in the accounts you want as you go — the dashboard ticks each one green when it's ready.",
    icon: Sparkles,
    tone: "indigo",
  },
  {
    minute: "0:10",
    title: "Create your first client sub-account",
    description:
      "Each client gets their own private workspace — contacts, deals, forms, members — sealed off from every other client. They never see each other. Period.",
    icon: Building2,
    tone: "violet",
  },
  {
    minute: "0:20",
    title: "Build a form, attach an automation",
    description:
      "Drag-order builder, embed snippet, theme + accent. Wire the Speed-to-Lead recipe so every submit fires SMS + email + owner notify.",
    icon: FileText,
    tone: "pink",
  },
  {
    minute: "0:35",
    title: "Generate the client's marketing site",
    description:
      "Sub-account → Website → fill the form (or click Sample). The builder publishes a live URL in 1–3 minutes. Embed your form straight into it.",
    icon: Globe,
    tone: "emerald",
  },
  {
    minute: "1:00",
    title: "Hand the keys over",
    description:
      "Invite the client as an admin or collaborator on their sub-account. They see only their workspace. You manage all of them from /agency.",
    icon: Wand2,
    tone: "amber",
  },
];

const TONE_CLASSES: Record<Step["tone"], { bg: string; text: string; ring: string }> = {
  indigo: {
    bg: "bg-indigo-500/10",
    text: "text-indigo-600 dark:text-indigo-400",
    ring: "ring-indigo-500/20",
  },
  violet: {
    bg: "bg-violet-500/10",
    text: "text-violet-600 dark:text-violet-400",
    ring: "ring-violet-500/20",
  },
  pink: {
    bg: "bg-pink-500/10",
    text: "text-pink-600 dark:text-pink-400",
    ring: "ring-pink-500/20",
  },
  emerald: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
    ring: "ring-emerald-500/20",
  },
  amber: {
    bg: "bg-amber-500/10",
    text: "text-amber-600 dark:text-amber-400",
    ring: "ring-amber-500/20",
  },
};

export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-muted/30 py-24">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            From zero to revenue
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tighter sm:text-5xl">
            From sign-up to a live client workspace,{" "}
            <span className="font-serif font-normal italic">
              in one hour.
            </span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground lg:text-xl">
            Sixty minutes from clone to a live client workspace. Five
            concrete steps. No consulting engagement. No implementation
            invoice.{" "}
            <span className="text-muted-foreground/80">
              (For context: GoHighLevel takes 2–6 weeks; HubSpot
              Professional adds $3K mandatory onboarding on top of
              $890+/mo.)
            </span>
          </p>
        </div>

        <div className="mx-auto mt-14 max-w-3xl">
          <ol className="relative space-y-4 border-l border-dashed border-foreground/15 pl-6 sm:space-y-6 sm:pl-8">
            {steps.map((step, i) => {
              const Icon = step.icon;
              const tone = TONE_CLASSES[step.tone];
              return (
                <li key={step.minute} className="relative">
                  <span
                    className={`absolute -left-[34px] top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background ring-4 ${tone.ring} sm:-left-[42px] sm:h-7 sm:w-7`}
                  >
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full ${tone.bg} ${tone.text} sm:h-5 sm:w-5`}
                    >
                      <Icon className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                    </span>
                  </span>
                  <div className="rounded-2xl border bg-background p-5 shadow-sm">
                    <div className="mb-1 flex items-center gap-3">
                      <span
                        className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold ${tone.bg} ${tone.text}`}
                      >
                        {step.minute}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Step {i + 1} of {steps.length}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold tracking-tight">
                      {step.title}
                    </h3>
                    <p className="mt-1.5 text-sm text-muted-foreground lg:text-base">
                      {step.description}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <p className="mx-auto mt-10 max-w-xl text-center text-xs text-muted-foreground">
          Times are realistic for someone who&apos;s done it once. First time
          through, budget two hours and have your database, payments, and
          email provider accounts ready.
        </p>
      </div>
    </section>
  );
}
