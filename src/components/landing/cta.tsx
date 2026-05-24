"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFoundersCohort } from "@/hooks/use-founders-cohort";

export function CTA() {
  const cohort = useFoundersCohort();
  const foundersOpen = cohort.soldCount < cohort.slotsTotal;

  return (
    <section className="relative overflow-hidden py-24">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,oklch(0.62_0.25_290)_/_12%,transparent_60%)]" />

      <div className="container mx-auto px-4 text-center">
        <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tighter sm:text-5xl">
          Set up your first client workspace{" "}
          <span className="font-serif font-normal italic">this afternoon.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground lg:text-xl">
          Sixty minutes from start to a real client demo. Sub-account, form,
          automation, live website — all running, all branded, all yours.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            render={<a href="#pricing" data-cta="cta-section-primary" />}
            size="lg"
            className="px-6 text-base"
          >
            {foundersOpen
              ? "Claim Founders slot — $891"
              : "Get instant access — $1,782"}
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
          <Button
            render={<a href="#pricing" />}
            variant="outline"
            size="lg"
            className="px-6 text-base"
          >
            See pricing
          </Button>
        </div>
        {foundersOpen && (
          <p className="mt-3 text-xs text-muted-foreground">
            <span className="line-through">$1,782</span> after the{" "}
            {cohort.slotsTotal} founders sell out
          </p>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          One-time payment · live in 60 minutes · True Founders bonus stack
          included (first 10 only) · Export anytime
        </p>
      </div>
    </section>
  );
}
