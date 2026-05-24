"use client";

import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/brand/logo-mark";
import { openCrispChat } from "@/lib/crisp";

export default function ThankYouPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center px-4">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold">
            <LogoMark size={20} idSuffix="-thanks" />
            LeadStack
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="mx-auto max-w-xl text-center">
          <span className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-7 w-7" />
          </span>

          <h1 className="text-3xl font-semibold tracking-tighter sm:text-4xl">
            You&apos;re a Founder.
          </h1>

          <p className="mx-auto mt-4 max-w-md text-lg text-muted-foreground">
            Payment received. Your Founders slot is locked in at $891.
          </p>

          <div className="mx-auto mt-8 max-w-md rounded-2xl border bg-card/50 p-6 text-left">
            <h2 className="text-base font-semibold">What happens next</h2>
            <ol className="mt-3 space-y-3 text-sm text-muted-foreground">
              <li className="flex gap-3">
                <span className="font-mono text-xs text-foreground/60">1.</span>
                <span>
                  We&apos;ll email you within 24 hours with your GitHub access
                  and onboarding details. Check your inbox (and spam) for a
                  message from{" "}
                  <span className="font-medium text-foreground">
                    notifications@leadstack.dev
                  </span>
                  .
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-xs text-foreground/60">2.</span>
                <span>
                  We&apos;ll book your 1:1 onboarding call and share the
                  setup walkthrough.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-xs text-foreground/60">3.</span>
                <span>
                  Your direct line to the founder opens for 30 days from today — use it
                  whenever you hit a wall.
                </span>
              </li>
            </ol>
          </div>

          <a
            href="https://www.skool.com/ambitious"
            target="_blank"
            rel="noopener noreferrer"
            className="mx-auto mt-6 flex max-w-md items-center gap-4 rounded-2xl border border-primary/30 bg-gradient-to-br from-indigo-500/10 via-violet-500/5 to-pink-500/10 p-5 text-left transition-colors hover:border-primary/50"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Users className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                Join the Founders community
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Free for all founders. Trade wins, code patterns, and client
                stories inside our private Skool community.
              </span>
            </span>
          </a>

          <div className="mt-8">
            <Button render={<Link href="/" />} variant="outline">
              Back to home
            </Button>
          </div>

          <p className="mt-8 text-xs text-muted-foreground">
            Need help right now?{" "}
            <button
              type="button"
              onClick={openCrispChat}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Chat with us
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
