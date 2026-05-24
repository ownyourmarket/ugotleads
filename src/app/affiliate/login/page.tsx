import Link from "next/link";
import { notFound } from "next/navigation";
import { LANDING_VARIANT } from "@/config/landing";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  missing_token: "That sign-in link was incomplete. Request a new one below.",
  expired: "That sign-in link has expired or was already used. Request a new one below.",
  not_found: "We couldn't find your account. Make sure you're using the email you bought LeadStack with.",
  inactive: "Your affiliate account is paused. Email hello@leadstack.dev if you think this is a mistake.",
};

export default async function AffiliateLoginPage({ searchParams }: PageProps) {
  if (LANDING_VARIANT !== "leadstack") notFound();
  const sp = await searchParams;
  const errorMessage = sp.error ? ERROR_MESSAGES[sp.error] ?? null : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">
          Affiliate sign-in
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter the email you purchased LeadStack with. We&apos;ll send you a
          one-tap sign-in link.
        </p>
        {errorMessage && (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {errorMessage}
          </div>
        )}
        <LoginForm />
        <p className="mt-6 text-xs text-muted-foreground">
          Don&apos;t have an account yet? Affiliate accounts are auto-created
          when you purchase LeadStack at{" "}
          <Link
            href="/#pricing"
            className="text-foreground underline-offset-4 hover:underline"
          >
            leadstack.dev
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
