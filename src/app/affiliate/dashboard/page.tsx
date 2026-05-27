import { notFound, redirect } from "next/navigation";
import { LANDING_VARIANT } from "@/config/landing";
import { getCurrentAffiliate } from "@/lib/affiliate/session";
import { formatCents } from "@/lib/affiliate/dashboard-data";
import { DashboardShell } from "@/components/affiliate/dashboard-shell";
import { CopyButton } from "@/components/affiliate/copy-button";

export const dynamic = "force-dynamic";

export default async function AffiliateDashboardPage() {
  if (LANDING_VARIANT !== "leadstack") notFound();

  const affiliate = await getCurrentAffiliate();
  if (!affiliate) redirect("/affiliate/login");

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://ugotleads.io";
  const trackedLink = `${baseUrl}/?ref=${affiliate.code}`;
  const totalCommission =
    affiliate.pendingCommissionCents + affiliate.paidCommissionCents;

  return (
    <DashboardShell activeTab="overview" affiliateEmail={affiliate.email}>
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Your affiliate code
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            You earn{" "}
            <span className="font-medium text-foreground">
              {affiliate.commissionPct}% commission
            </span>{" "}
            ({formatCents(89100 * affiliate.commissionPct / 100 | 0)} per
            Founders sale) on anyone who buys via your link.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <code className="rounded-md border bg-muted px-3 py-2 font-mono text-base">
              {affiliate.code}
            </code>
            <CopyButton value={affiliate.code} label="Copy code" />
          </div>

          <div className="mt-4 rounded-lg border bg-muted/40 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Your tracked link
            </p>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 truncate font-mono text-xs">
                {trackedLink}
              </code>
              <CopyButton value={trackedLink} label="Copy link" />
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Referrals"
            value={affiliate.referralCount.toString()}
          />
          <StatCard
            label="Pending commission"
            value={formatCents(affiliate.pendingCommissionCents)}
          />
          <StatCard
            label="Paid out"
            value={formatCents(affiliate.paidCommissionCents)}
          />
        </div>

        {totalCommission > 0 && (
          <p className="text-xs text-muted-foreground">
            Lifetime earned:{" "}
            <span className="font-medium text-foreground">
              {formatCents(totalCommission)}
            </span>
            . Payouts are processed manually within 7 days of a referred sale
            clearing — reply to your welcome email to confirm your payout
            method (PayPal or bank transfer).
          </p>
        )}

        <div className="rounded-2xl border bg-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            How to earn your first commission
          </h2>
          <ol className="mt-4 space-y-4 text-sm">
            <li className="flex gap-3">
              <span className="font-mono text-xs text-muted-foreground">1.</span>
              <div>
                <p className="font-medium">Share your tracked link</p>
                <p className="mt-1 text-muted-foreground">
                  Add{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    ?ref={affiliate.code}
                  </code>{" "}
                  to any ugotleads.io URL you share. Attribution is captured
                  for 30 days from the click — so even if your contact buys
                  weeks later, you still get credit.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-xs text-muted-foreground">2.</span>
              <div>
                <p className="font-medium">
                  Pick the right people, not the most people
                </p>
                <p className="mt-1 text-muted-foreground">
                  UGotLeads converts best with agency owners, freelancers
                  building client tools, and consultants who already sell to
                  small businesses. Targeted DMs beat broadcast.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-xs text-muted-foreground">3.</span>
              <div>
                <p className="font-medium">Lead with the problem you solved</p>
                <p className="mt-1 text-muted-foreground">
                  Don&apos;t open with a sales pitch. Mention what made you
                  buy and what you&apos;ve built since. Share the tracked
                  link only when they ask &quot;where do I sign up?&quot;
                </p>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </DashboardShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}
