import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Layers,
  Puzzle,
  Sparkles,
  Wand2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "PromptExpert — your best AI prompts, one click away | UGotLeads",
  description:
    "Save your winning prompts, load your brand context once, and run AI skills that deliver on-brand work in one click — inside UGotLeads.",
};

const PIECES = [
  {
    name: "Prompts",
    body: "The instructions you've already refined — saved once, reused across every AI call instead of retyped from scratch each time.",
  },
  {
    name: "Gems",
    body: "Bite-sized brand context — your bio, tone rules, offer details — that plug into any prompt with an @mention so the model always knows who you are.",
  },
  {
    name: "Skills",
    body: "One-click AI actions that combine a prompt with your gems and the model: a cold email opener, a social caption, a proposal draft, done in seconds.",
  },
  {
    name: "GPTs",
    body: "Custom assistants scoped to one job — onboarding FAQs, objection handling, deal review — ready to chat inside UGotLeads whenever you need them.",
  },
  {
    name: "Growth Agents",
    body: "Autonomous agents that run your skills on a schedule — no click required. Set the cadence once and let the work happen in the background.",
    comingSoon: true,
  },
];

const STEPS = [
  {
    icon: Layers,
    title: "Load your context",
    body: "Add your brand bio, tone rules, and offer details once as gems. Every prompt and skill can pull from them from that point on.",
  },
  {
    icon: Sparkles,
    title: "Save your winners",
    body: "When a prompt produces work you'd actually send, save it. It becomes a reusable skill instead of a one-off you'll have to recreate later.",
  },
  {
    icon: Zap,
    title: "Run everywhere",
    body: "Fire a skill from a contact profile, a deal, or a blank page. On-brand output in one click, every time, without re-explaining yourself.",
  },
];

export default function PromptExpertPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1">
        <HeroSection />
        <FivePiecesSection />
        <HowItWorksSection />
        <FinalCtaSection />
      </main>
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden py-20 md:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,oklch(0.72_0.16_165)_/_18%,transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_bottom_left,oklch(0.74_0.13_185)_/_14%,transparent_55%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[1px] bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />

      <div className="container mx-auto px-4">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div className="mx-auto max-w-2xl text-center lg:mx-0 lg:text-left">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1 text-xs font-medium uppercase tracking-wide lg:mx-0">
              <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
              <span className="bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300 bg-clip-text text-transparent">
                PromptExpert · included with UGotLeads credit plans
              </span>
            </div>

            <h1 className="mt-8 text-balance text-4xl font-semibold tracking-tighter sm:text-5xl md:text-6xl lg:leading-[1.04]">
              Your best AI prompts,{" "}
              <span className="inline-block bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300 bg-clip-text pr-1 font-serif font-normal text-transparent">
                one click away
              </span>
              .
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-muted-foreground md:text-xl lg:mx-0">
              Save your winning prompts, load your brand context once, and
              run AI skills that deliver on-brand work in one click — inside
              UGotLeads. No more re-explaining your business to a blank
              prompt box.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
              <Button
                render={<Link href="/signup" />}
                size="lg"
                className="px-6 text-base"
              >
                Get started free
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                render={<Link href="/login" />}
                variant="ghost"
                size="lg"
                className="px-6 text-base"
              >
                Log in
              </Button>
            </div>
          </div>

          <div className="mx-auto w-full max-w-md lg:mx-0">
            <PromptCard />
          </div>
        </div>
      </div>
    </section>
  );
}

function PromptCard() {
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-lg shadow-primary/5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Wand2 className="h-4.5 w-4.5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Cold Email Opener</p>
            <p className="text-xs text-muted-foreground">Skill</p>
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0">
          5 credits / run
        </Badge>
      </div>

      <div className="mt-5 rounded-xl border bg-muted/40 p-4 text-sm leading-relaxed text-foreground/90">
        Write a cold email opener for{" "}
        <span className="inline-flex items-center rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[0.8rem] text-amber-600 dark:text-amber-400">
          [Prospect_Name]
        </span>{" "}
        at{" "}
        <span className="inline-flex items-center rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[0.8rem] text-amber-600 dark:text-amber-400">
          [Company]
        </span>{" "}
        that matches the tone in{" "}
        <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[0.8rem] font-medium text-primary">
          @Brand Bio
        </span>
        .
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Slots fill in from the contact. Brand tone loads from your saved
        gem. You just hit run.
      </p>
    </div>
  );
}

function FivePiecesSection() {
  return (
    <section className="py-24">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            The system
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tighter sm:text-5xl">
            Five pieces,{" "}
            <span className="font-serif font-normal italic">
              one system
            </span>
            .
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Each piece does one job. Together they turn a blank prompt box
            into a repeatable, on-brand AI workflow.
          </p>
        </div>

        <div className="mx-auto mt-14 max-w-3xl divide-y divide-border border-t">
          {PIECES.map((piece, index) => (
            <div
              key={piece.name}
              className="flex flex-col gap-2 py-7 sm:flex-row sm:items-baseline sm:gap-8"
            >
              <span className="font-serif text-3xl font-normal text-muted-foreground/50 sm:w-14 sm:shrink-0">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                  {piece.name}
                  {piece.comingSoon && (
                    <Badge variant="outline" className="font-normal">
                      Coming soon
                    </Badge>
                  )}
                </h3>
                <p className="mt-1.5 max-w-xl text-muted-foreground">
                  {piece.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section className="border-t py-24">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            How it works
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tighter sm:text-5xl">
            Three steps.{" "}
            <span className="font-serif font-normal italic">
              Zero re-explaining.
            </span>
          </h2>
        </div>

        <div className="mx-auto mt-16 grid max-w-4xl gap-6 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, index) => (
            <div
              key={title}
              className="rounded-2xl border bg-card p-6"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="font-serif text-2xl font-normal text-muted-foreground/50">
                  {index + 1}
                </span>
              </div>
              <h3 className="mt-4 text-base font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCtaSection() {
  return (
    <section className="relative overflow-hidden border-t py-24">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,oklch(0.72_0.16_165)_/_14%,transparent_60%)]" />

      <div className="container mx-auto px-4 text-center">
        <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tighter sm:text-5xl">
          Stop retyping.{" "}
          <span className="font-serif font-normal italic">
            Start running.
          </span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
          PromptExpert is included with every UGotLeads credit plan. Load
          your brand once and let every AI skill run on-brand from day one.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            render={<Link href="/signup" />}
            size="lg"
            className="px-6 text-base"
          >
            Get started free
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        <p className="mt-10 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <Puzzle className="h-3.5 w-3.5" />
          PromptExpert is part of{" "}
          <Link
            href="/"
            className="font-medium text-foreground transition-colors hover:text-primary"
          >
            UGotLeads
          </Link>{" "}
          — the done-for-you growth CRM.
        </p>
      </div>
    </section>
  );
}
