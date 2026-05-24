"use client";

import { Zap } from "lucide-react";
import { useFoundersCohort } from "@/hooks/use-founders-cohort";

export function AnnouncementBar() {
  const cohort = useFoundersCohort();
  const soldOut = cohort.soldCount >= cohort.slotsTotal;

  if (soldOut) return null;

  return (
    <a
      href="#pricing"
      data-cta="announcement-bar"
      className="block bg-gradient-to-r from-indigo-600 via-violet-600 to-pink-600 py-2.5 text-white transition-opacity hover:opacity-95"
    >
      <div className="container mx-auto flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 text-center text-xs sm:text-sm">
        <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="font-semibold tracking-tight">Founders Cohort</span>
        <span className="text-white/60" aria-hidden="true">·</span>
        <span>
          <span className="font-bold">$891</span>
          <span className="ml-1.5 text-white/70 line-through">$1,782</span>
        </span>
        <span className="hidden text-white/60 sm:inline" aria-hidden="true">·</span>
        <span className="hidden italic sm:inline">Yours forever</span>
        <span className="hidden text-white/60 md:inline" aria-hidden="true">·</span>
        <span className="hidden md:inline">50 slots only</span>
        <span className="ml-1 font-semibold" aria-hidden="true">→</span>
      </div>
    </a>
  );
}
