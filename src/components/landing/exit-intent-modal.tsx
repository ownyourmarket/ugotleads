"use client";

import { useEffect, useState } from "react";
import { Loader2, Zap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useFoundersCohort, waveCap } from "@/hooks/use-founders-cohort";
import { useFoundersCheckout } from "@/hooks/use-founders-checkout";

const SESSION_KEY = "leadstack:exit-intent-shown";
const ARM_DELAY_MS = 10_000;
const EXIT_DISCOUNT_CODE = "TAKE297";

export function ExitIntentModal() {
  const cohort = useFoundersCohort();
  const { startCheckout, loading: checkoutLoading } = useFoundersCheckout();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (sessionStorage.getItem(SESSION_KEY) === "1") return;

    let armed = false;
    const armTimer = window.setTimeout(() => {
      armed = true;
    }, ARM_DELAY_MS);

    const onMouseLeave = (e: MouseEvent) => {
      if (!armed) return;
      if (e.clientY > 0) return;
      sessionStorage.setItem(SESSION_KEY, "1");
      setOpen(true);
      document.removeEventListener("mouseleave", onMouseLeave);
    };

    document.addEventListener("mouseleave", onMouseLeave);
    return () => {
      window.clearTimeout(armTimer);
      document.removeEventListener("mouseleave", onMouseLeave);
    };
  }, []);

  if (!cohort.hydrated || cohort.currentWave !== 1) return null;
  const remaining = Math.max(0, waveCap(1) - Math.min(cohort.soldCount, waveCap(1)));
  if (remaining <= 0) return null;

  const handleClaim = () => {
    // Pre-apply the GETLEADSTACK discount on the Stripe session itself —
    // buyer lands on checkout with the $200 off already showing, no
    // manual code entry. Server silently no-ops if the coupon isn't yet
    // configured in Stripe Dashboard.
    void startCheckout({ discountCode: EXIT_DISCOUNT_CODE });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 via-violet-500/20 to-pink-500/20 text-primary">
            <Zap className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center text-xl font-semibold tracking-tight">
            Get an extra $297 off
          </DialogTitle>
          <DialogDescription className="text-center text-sm">
            One-time only. Code applied automatically at checkout.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button
            onClick={handleClaim}
            disabled={checkoutLoading}
            size="lg"
            data-cta="exit-intent-claim"
            className="cta-glow bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500 text-white hover:opacity-90"
          >
            {checkoutLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting checkout…
              </>
            ) : (
              "Claim my $297 off →"
            )}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            onClick={() => setOpen(false)}
            disabled={checkoutLoading}
          >
            No thanks
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
