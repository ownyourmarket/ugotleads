import Link from "next/link";
import { LogoMark } from "@/components/brand/logo-mark";
import { LogoutButton } from "@/components/affiliate/logout-button";

interface DashboardShellProps {
  activeTab: "overview" | "conversions";
  affiliateEmail: string;
  children: React.ReactNode;
}

export function DashboardShell({
  activeTab,
  affiliateEmail,
  children,
}: DashboardShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link
            href="/affiliate/dashboard"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <LogoMark size={18} idSuffix="-aff" />
            LeadStack <span className="text-xs font-medium text-muted-foreground">Affiliate</span>
          </Link>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden sm:inline">{affiliateEmail}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <div className="container mx-auto flex-1 px-4 py-8">
        <nav className="mb-6 flex gap-1 border-b">
          <DashboardTab
            href="/affiliate/dashboard"
            active={activeTab === "overview"}
          >
            Overview
          </DashboardTab>
          <DashboardTab
            href="/affiliate/dashboard/conversions"
            active={activeTab === "conversions"}
          >
            Conversions
          </DashboardTab>
        </nav>
        {children}
      </div>
    </div>
  );
}

function DashboardTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "border-b-2 border-primary px-3 py-2 text-sm font-medium text-foreground"
          : "border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      }
    >
      {children}
    </Link>
  );
}
