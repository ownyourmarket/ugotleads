"use client";

import { useEffect } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo-mark";
import { useAuth } from "@/hooks/use-auth";
import { useLandingMetrics } from "@/hooks/use-landing-metrics";
import type { HeroVariantId } from "@/lib/hero-variants";

interface FooterProps {
  /** Hero variant for the current visitor — used to bucket pageView +
   *  ctaClick events for the A/B/C test. Optional so the legacy footer
   *  still type-checks if mounted outside the variant-aware page. */
  variant?: HeroVariantId;
}

export function Footer({ variant }: FooterProps = {}) {
  const { user, loading } = useAuth();
  const { pageViews, ctaClicks, hydrated, trackCta } =
    useLandingMetrics(variant);

  // Delegated click capture: any element with a [data-cta] attribute
  // anywhere on the page counts as a conversion-intent click. Saves
  // wiring an onClick into every individual CTA button.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target || typeof target.closest !== "function") return;
      if (target.closest("[data-cta]")) trackCta();
    };
    document.addEventListener("click", handler, { capture: true });
    return () =>
      document.removeEventListener("click", handler, { capture: true });
  }, [trackCta]);

  const conversionRate =
    hydrated && pageViews > 0
      ? ((ctaClicks / pageViews) * 100).toFixed(1)
      : null;

  return (
    <footer className="border-t py-12">
      <div className="container mx-auto px-4">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-1">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold">
              <LogoMark size={20} idSuffix="-footer" />
              UGotLeads
            </Link>
            <p className="mt-3 text-sm text-muted-foreground">
              The all-in-one CRM for small teams that want to close, not
              configure.
            </p>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold">Product</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a
                  href="#features"
                  className="transition-colors hover:text-foreground"
                >
                  Features
                </a>
              </li>
              <li>
                <a
                  href="#how-it-works"
                  className="transition-colors hover:text-foreground"
                >
                  How it works
                </a>
              </li>
              <li>
                <a
                  href="#pricing"
                  className="transition-colors hover:text-foreground"
                >
                  Pricing
                </a>
              </li>
              <li>
                <a
                  href="#faq"
                  className="transition-colors hover:text-foreground"
                >
                  FAQ
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold">Community</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a
                  href="https://www.skool.com/ambitious"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-foreground"
                >
                  Join my Skool
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold">Legal</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link
                  href="/terms"
                  className="transition-colors hover:text-foreground"
                >
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link
                  href="/privacy"
                  className="transition-colors hover:text-foreground"
                >
                  Privacy Policy
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold">Admin</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              For workspace owners. Customers, please use Buy Now above.
            </p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {!loading && (
                <>
                  {user ? (
                    <li>
                      <Link
                        href="/dashboard"
                        className="transition-colors hover:text-foreground"
                      >
                        Dashboard
                      </Link>
                    </li>
                  ) : (
                    <>
                      <li>
                        <Link
                          href="/login"
                          className="transition-colors hover:text-foreground"
                        >
                          Sign in
                        </Link>
                      </li>
                      <li>
                        <Link
                          href="/signup"
                          className="transition-colors hover:text-foreground"
                        >
                          Sign up
                        </Link>
                      </li>
                    </>
                  )}
                </>
              )}
            </ul>
          </div>

        </div>

        <div className="mt-8 border-t pt-8 text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} UGotLeads. All rights reserved.
          {hydrated && (
            <p className="mt-2 font-mono text-[10px] tracking-tight text-muted-foreground/50">
              <span title="Total landing-page views">
                {pageViews.toLocaleString()}v
              </span>{" "}
              <span title="Total clicks on primary purchase CTAs">
                {ctaClicks.toLocaleString()}c
              </span>
              {conversionRate !== null && (
                <>
                  {" "}
                  <span title="CTA clicks ÷ visits">{conversionRate}w</span>
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
