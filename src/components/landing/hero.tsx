"use client";

import { useEffect } from "react";
import {
  ArrowRight,
  Building2,
  Globe,
  Loader2,
  Shield,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFoundersCohort } from "@/hooks/use-founders-cohort";
import { useFoundersCheckout } from "@/hooks/use-founders-checkout";
import {
  HERO_VARIANTS,
  HERO_VARIANT_COOKIE,
  HERO_VARIANT_COOKIE_MAX_AGE_SECONDS,
  type HeroVariantId,
} from "@/lib/hero-variants";

interface HeroProps {
  /** Server-resolved variant. Pinned per visitor via cookie. */
  variant: HeroVariantId;
}

export function Hero({ variant }: HeroProps) {
  const cohort = useFoundersCohort();
  const foundersOpen = cohort.soldCount < cohort.slotsTotal;
  const { startCheckout, loading: checkoutLoading } = useFoundersCheckout();
  const copy = HERO_VARIANTS[variant];

  // First-render-only: persist the variant to a 90-day cookie if not
  // already set. Server can read cookies but can't set them mid-render,
  // so this client-side write is what pins subsequent visits to the same
  // variant. If the cookie already exists, document.cookie set is a no-op
  // with the same value.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const existing = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${HERO_VARIANT_COOKIE}=`));
    if (existing) return;
    const secure =
      window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie =
      `${HERO_VARIANT_COOKIE}=${variant}; Max-Age=${HERO_VARIANT_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax` +
      secure;
  }, [variant]);
  return (
    <section className="relative overflow-hidden py-20 md:py-28">
      {/* Gradient background effects */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,oklch(0.62_0.25_290)_/_16%,transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_bottom_left,oklch(0.65_0.2_220)_/_12%,transparent_55%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[1px] bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />

      {/* Subtle grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-8 flex items-center justify-center gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            <span>Capture</span>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-foreground/30" />
            <span>Nurture</span>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-foreground/30" />
            <span>Close</span>
          </div>

          <h1 className="text-balance text-4xl font-semibold tracking-tighter sm:text-5xl md:text-6xl lg:text-[5rem] lg:leading-[1.04]">
            {copy.headlinePre}{" "}
            <span className="inline-block bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500 bg-clip-text pr-1 font-serif font-normal text-transparent">
              {copy.headlineGradient}
            </span>
            {copy.headlinePost ? <> {copy.headlinePost}</> : null}
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground md:text-xl">
            {copy.subhead}
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              onClick={() => startCheckout()}
              disabled={checkoutLoading}
              size="lg"
              className="cta-glow px-6 text-base"
              data-cta="hero-primary"
            >
              {checkoutLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting checkout…
                </>
              ) : (
                <>
                  {foundersOpen
                    ? "Claim Founders slot — $891"
                    : "Get instant access — $1,782"}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </>
              )}
            </Button>
            <Button
              render={<a href="#how-it-works" />}
              variant="outline"
              size="lg"
              className="px-6 text-base"
            >
              See the 60-minute walkthrough
            </Button>
          </div>

          {foundersOpen && cohort.hydrated && (
            <p className="mt-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {cohort.soldCount} of {cohort.slotsTotal}
              </span>{" "}
              founders claimed ·{" "}
              <span className="line-through">$1,782</span> after sellout
            </p>
          )}

          <p className="mt-4 text-sm text-muted-foreground">
            One-time payment · live in 60 minutes · yours forever
          </p>

          {/* Capability strip — concrete claims, not vanity numbers */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-indigo-500" />
              <span className="font-medium text-foreground">
                One license
              </span>
              <span>· unlimited sub-accounts</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-violet-500" />
              <span className="font-medium text-foreground">
                Built-in automations
              </span>
              <span>· follow-ups that fire while you sleep</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-emerald-500" />
              <span className="font-medium text-foreground">
                Website builder
              </span>
              <span>· live URL in 1–3 minutes</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-pink-500" />
              <span className="font-medium text-foreground">Yours forever</span>
              <span>· own the code, the data, the customers</span>
            </div>
          </div>
        </div>

        {/* Workspace mock — sub-account picker as the headline visual */}
        <div className="mx-auto mt-16 max-w-5xl">
          <div className="relative rounded-2xl border bg-card/80 p-1 shadow-2xl shadow-indigo-500/10 backdrop-blur">
            <div className="absolute -top-3 right-6 z-10 hidden items-center gap-1.5 rounded-full border border-primary/20 bg-background px-2.5 py-1 text-[10px] font-semibold shadow-md sm:inline-flex">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              LIVE · 4 client workspaces
            </div>

            <div className="rounded-[14px] border bg-background">
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-400/60" />
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-400/60" />
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-400/60" />
                </div>
                <span className="ml-4 text-xs text-muted-foreground">
                  app.youragency.com / agency
                </span>
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-[200px_1fr]">
                <div className="hidden space-y-1 rounded-lg bg-muted/40 p-2 text-xs sm:block">
                  <p className="px-2 pb-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                    Agency
                  </p>
                  {[
                    ["Get started", false],
                    ["Agency home", true],
                    ["Sub-accounts", false],
                  ].map(([label, active]) => (
                    <div
                      key={label as string}
                      className={
                        active
                          ? "rounded-md bg-primary/10 px-2 py-1.5 font-medium text-primary"
                          : "rounded-md px-2 py-1.5 text-muted-foreground"
                      }
                    >
                      {label}
                    </div>
                  ))}
                  <div className="mt-3 rounded-md border border-dashed border-emerald-500/30 bg-emerald-500/5 p-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                      <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      All systems live
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Every workspace humming
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Your sub-accounts</h3>
                    <span className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground">
                      + New sub-account
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      {
                        name: "Acme Plumbing",
                        accountNumber: "1001",
                        meta: "12 leads · pipeline live",
                        tone: "from-indigo-500/10 to-violet-500/10",
                      },
                      {
                        name: "BrightLab Coffee",
                        accountNumber: "1002",
                        meta: "Site published · 3 forms",
                        tone: "from-emerald-500/10 to-teal-500/10",
                      },
                      {
                        name: "Atlas Home Services",
                        accountNumber: "1003",
                        meta: "Automation firing · 47 contacts",
                        tone: "from-pink-500/10 to-amber-500/10",
                      },
                      {
                        name: "Northwind Roofing",
                        accountNumber: "1004",
                        meta: "Onboarding · setup 80%",
                        tone: "from-sky-500/10 to-blue-500/10",
                      },
                    ].map((row) => (
                      <div
                        key={row.accountNumber}
                        className={`rounded-lg border bg-gradient-to-br p-3 text-xs ${row.tone}`}
                      >
                        <div className="flex items-baseline gap-1.5">
                          <p className="truncate font-medium">{row.name}</p>
                          <span className="font-mono text-[9px] text-muted-foreground">
                            #{row.accountNumber}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-[10px] text-muted-foreground">
                          {row.meta}
                        </p>
                        <p className="mt-2 flex items-center gap-1 text-[10px] text-primary">
                          <Users className="h-2.5 w-2.5" />
                          Open →
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
