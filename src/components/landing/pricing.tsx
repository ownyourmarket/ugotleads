"use client";

import { Check, Loader2, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  useFoundersCohort,
  waveBonus,
  waveGitpageMonths,
  waveLabel,
  waveSavings,
} from "@/hooks/use-founders-cohort";
import { useFoundersCheckout } from "@/hooks/use-founders-checkout";
import { openCrispChat } from "@/lib/crisp";

// One-time SKUs. The Stripe checkout helper currently builds subscription
// sessions and requires an authenticated admin — the buttons below fall back
// to a mailto so the page works end-to-end today. When the checkout helper
// is rewritten to `mode: "payment"` with anonymous checkout, swap the
// `mailto:` href for a Stripe Checkout call keyed to STRIPE_REPO_PRICE_ID
// or STRIPE_FULL_PRICE_ID.
type Plan = {
  name: string;
  tagline: string;
  price: number;
  features: string[];
  cta: string;
  highlighted?: boolean;
};

const plans: Plan[] = [
  {
    name: "Repo Only",
    tagline: "The codebase. Yours to keep, yours to brand.",
    price: 1782,
    features: [
      "Full LeadStack source code",
      "Unlimited sub-accounts, unlimited contacts",
      "Personal access from the founder, within 24 hours",
      "Email support from the founder",
    ],
    cta: "Get instant access",
  },
];

export function Pricing() {
  const cohort = useFoundersCohort();
  const filledInWave =
    cohort.currentWave === 1
      ? Math.min(cohort.soldCount, 10)
      : cohort.currentWave === 2
        ? Math.max(0, Math.min(cohort.soldCount, 30) - 10)
        : Math.max(0, Math.min(cohort.soldCount, 50) - 30);
  const slotsInWave = cohort.currentWave === 1 ? 10 : cohort.currentWave === 2 ? 20 : 20;
  const remaining = Math.max(0, slotsInWave - filledInWave);
  const progressPct = Math.min(
    100,
    Math.round((filledInWave / slotsInWave) * 100),
  );
  const soldOut = cohort.soldCount >= cohort.slotsTotal;

  const {
    startCheckout: handleClaimFoundersSlot,
    loading: checkoutLoading,
    error: checkoutError,
  } = useFoundersCheckout();

  return (
    <section id="pricing" className="py-24">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            Pricing
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tighter sm:text-5xl">
            One payment.{" "}
            <span className="font-serif font-normal italic">
              No subscription
            </span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground lg:text-xl">
            No subscription. No per-contact tier. No per-message tax. The way
            professional software should be sold. Buy once, host it yourself,
            own the source code and the customer data.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-4xl">
          {/* Founders Cohort — featured banner above the public 2-col grid */}
          {!soldOut && (
            <div className="relative">
              {/* Badge sits OUTSIDE the Card so the Card's overflow-hidden
                  (needed to clip the grid background to rounded corners)
                  doesn't clip the half of the badge that sticks above. */}
              <Badge className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 gap-1 px-3">
                <Zap className="h-3 w-3" />
                Founders Cohort · 50 slots, 3 waves
              </Badge>
            <Card className="relative overflow-hidden border-primary/40 bg-gradient-to-br from-indigo-500/10 via-violet-500/5 to-pink-500/10 shadow-xl shadow-primary/10 ring-2 ring-primary/30">
              <div
                className="pointer-events-none absolute inset-0 -z-10 opacity-[0.05]"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
                  backgroundSize: "32px 32px",
                }}
              />

              <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center md:p-8">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-bold tracking-tight">
                      $891
                    </span>
                    <span className="text-muted-foreground">one-time</span>
                  </div>
                  <p className="mt-2 text-base font-medium text-foreground">
                    $891 once. Then $0/month forever.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    50% off retail $1,782 · save $
                    {waveSavings(cohort.currentWave).toLocaleString()} vs
                    public DIY + {waveGitpageMonths(cohort.currentWave)} months
                    Gitpage
                  </p>

                  <div className="mt-5">
                    <p className="text-sm font-medium text-foreground lg:text-base">
                      Wave {cohort.currentWave} —{" "}
                      <span className="text-primary">
                        {waveLabel(cohort.currentWave)}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground lg:text-base">
                      Includes {waveBonus(cohort.currentWave)}
                    </p>
                  </div>

                  {/* Slot counter */}
                  <div className="mt-5 max-w-md">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-medium">
                        {cohort.hydrated
                          ? `${filledInWave} of ${slotsInWave} ${waveLabel(cohort.currentWave)} slots filled`
                          : `${slotsInWave} ${waveLabel(cohort.currentWave)} slots`}
                      </span>
                      {cohort.hydrated && remaining > 0 && (
                        <span className="text-muted-foreground">
                          {remaining} left in this wave
                        </span>
                      )}
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-foreground/10">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500 transition-all duration-500"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {cohort.soldCount} of {cohort.slotsTotal} total founders
                      slots claimed across all waves
                    </p>
                  </div>

                  {/* Wave comparison — what you lose by waiting */}
                  <div className="mt-5 max-w-md">
                    <p className="text-xs font-medium text-foreground">
                      What you keep, by wave:
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {(
                        [
                          { wave: 1, months: 12, loss: 0 },
                          { wave: 2, months: 6, loss: 594 },
                          { wave: 3, months: 3, loss: 891 },
                        ] as const
                      ).map(({ wave, months, loss }) => {
                        const isCurrent = cohort.currentWave === wave;
                        return (
                          <li
                            key={wave}
                            className={cn(
                              "flex items-center gap-2",
                              isCurrent && "font-medium text-foreground",
                            )}
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 shrink-0 rounded-full",
                                isCurrent
                                  ? "bg-primary"
                                  : "bg-foreground/20",
                              )}
                            />
                            <span>
                              Wave {wave}: {months} months Gitpage included
                              {loss > 0 && (
                                <span className="text-muted-foreground/80">
                                  {" "}
                                  (−${loss} in bonus value)
                                </span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {/* Wave 1 / 2 bonus stack — shown when in those waves */}
                  {cohort.currentWave <= 2 && (
                    <ul className="mt-5 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:text-base">
                      {[
                        "1:1 onboarding call with the founder — 60 min",
                        "Direct line to the founder, anytime — first 30 days",
                      ].map((bonus) => (
                        <li key={bonus} className="flex items-start gap-2">
                          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                            <Check className="h-3 w-3" />
                          </span>
                          {bonus}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="md:w-48">
                  <Button
                    onClick={() => handleClaimFoundersSlot()}
                    disabled={checkoutLoading}
                    size="lg"
                    className="cta-glow w-full"
                    data-cta="pricing-founders"
                  >
                    {checkoutLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Starting checkout…
                      </>
                    ) : (
                      "Claim Founders slot"
                    )}
                  </Button>
                  {checkoutError && (
                    <p className="mt-2 text-center text-[11px] text-destructive md:text-left">
                      {checkoutError}. Try again, or{" "}
                      <button
                        type="button"
                        onClick={openCrispChat}
                        className="underline-offset-4 hover:underline"
                      >
                        chat with us
                      </button>
                      .
                    </p>
                  )}
                  <p className="mt-2 text-center text-[11px] text-muted-foreground md:text-left">
                    After purchase, we&apos;ll email you a link to access
                    LeadStack at the address on your Stripe receipt.
                  </p>
                  <p className="mt-2 text-center text-[11px] text-muted-foreground md:text-left">
                    Founding cohort recognition for the agencies backing us
                    before public testimonials. $891 holds across all 50
                    founders; once we have proof, this price never returns.
                  </p>
                </div>
              </div>
            </Card>
            </div>
          )}

          {!soldOut && (
            <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-muted-foreground lg:text-base">
              Once 50 founders&apos; slots fill, public price returns to{" "}
              <span className="font-medium text-foreground">$1,782</span> +
              Gitpage Agency at $99/mo.{" "}
              <span className="font-medium text-foreground/80">
                Same code. Different price.
              </span>
            </p>
          )}

          {soldOut && (
            <div className="mx-auto max-w-md">
              {plans.map((plan) => (
                <Card
                  key={plan.name}
                  className={cn(
                    "flex flex-col",
                    plan.highlighted &&
                      "relative border-primary shadow-xl shadow-primary/10 ring-2 ring-primary/30",
                  )}
                >
                {plan.highlighted && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 gap-1 px-3">
                    <Sparkles className="h-3 w-3" />
                    Most popular
                  </Badge>
                )}
                <CardHeader>
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  <CardDescription>{plan.tagline}</CardDescription>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-4xl font-bold tracking-tight">
                      ${plan.price.toLocaleString()}
                    </span>
                    <span className="text-muted-foreground">one-time</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Updates for the version you buy
                  </p>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-3">
                    {plan.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-start gap-2 text-sm lg:text-base"
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                            plan.highlighted
                              ? "bg-primary text-primary-foreground"
                              : "bg-primary/10 text-primary",
                          )}
                        >
                          <Check className="h-3 w-3" />
                        </span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button
                    onClick={openCrispChat}
                    data-cta="pricing-fallback"
                    variant={plan.highlighted ? "default" : "outline"}
                    className="w-full"
                  >
                    {plan.cta}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>

      </div>
    </section>
  );
}
