"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Menu } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/brand/logo-mark";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";
import { useFoundersCheckout } from "@/hooks/use-founders-checkout";

export function Navbar() {
  const [open, setOpen] = useState(false);
  const { startCheckout, loading } = useFoundersCheckout();

  const navItems = (
    <>
      <a
        href="#features"
        className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Features
      </a>
      <a
        href="#how-it-works"
        className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        How it works
      </a>
      <a
        href="#pricing"
        className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Pricing
      </a>
      <Button
        onClick={() => startCheckout()}
        disabled={loading}
        size="sm"
        data-cta="navbar-buy"
        className="cta-glow"
      >
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Starting…
          </>
        ) : (
          "Buy Now"
        )}
      </Button>
    </>
  );

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold">
          <LogoMark size={24} idSuffix="-nav" />
          UGotLeads
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-4 md:flex">
          <ThemeToggle />
          {navItems}
        </nav>

        {/* Mobile nav */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Menu</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-4 p-4">
              <SheetClose
                render={<a href="#features" />}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Features
              </SheetClose>
              <SheetClose
                render={<a href="#how-it-works" />}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                How it works
              </SheetClose>
              <SheetClose
                render={<a href="#pricing" />}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Pricing
              </SheetClose>
              <SheetClose render={<span />}>
                <Button
                  onClick={() => startCheckout()}
                  disabled={loading}
                  className="w-full cta-glow"
                  size="sm"
                  data-cta="navbar-buy"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Starting…
                    </>
                  ) : (
                    "Buy Now"
                  )}
                </Button>
              </SheetClose>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
