"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CheckoutButtonProps {
  tier: "starter" | "pro" | "scale";
  tierName: string;
  ctaLabel: string;
  highlighted: boolean;
}

/**
 * Self-serve checkout button. Opens a small dialog asking the visitor for
 * their email (Stripe requires this for receipt + customer creation),
 * POSTs to /api/checkout/public-subscription, and redirects to the
 * Stripe Checkout URL the server returns.
 *
 * If the tier isn't wired in Stripe yet (no STRIPE_*_PRICE_ID env var),
 * the server responds 400 → we show a friendly "talk to us" fallback.
 */
export function CheckoutButton({
  tier,
  tierName,
  ctaLabel,
  highlighted,
}: CheckoutButtonProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Enter your email to continue.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/checkout/public-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, email: email.trim() }),
      });
      const data = (await res.json()) as { url?: string; message?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.message ?? data.error ?? "Could not start checkout.");
        setLoading(false);
        return;
      }
      // Redirect to Stripe.
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant={highlighted ? "default" : "outline"}
        className="w-full"
      >
        {ctaLabel}
      </Button>
      <Dialog open={open} onOpenChange={(v) => !loading && setOpen(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start your {tierName} subscription</DialogTitle>
            <DialogDescription>
              We&apos;ll send you to Stripe to enter your card. Cancel anytime.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={startCheckout} className="space-y-3">
            <div>
              <label
                htmlFor="checkout-email"
                className="text-sm font-medium"
              >
                Your email
              </label>
              <Input
                id="checkout-email"
                type="email"
                placeholder="you@business.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
                autoFocus
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                You&apos;ll create a password after payment to access your workspace.
              </p>
            </div>
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950 p-3 text-sm text-red-900 dark:text-red-200">
                {error}
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Continue to Stripe
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
