import Link from "next/link";
import { notFound } from "next/navigation";
import { LANDING_VARIANT } from "@/config/landing";
import { getCurrentAgencyOwner } from "@/lib/auth/require-agency-owner";
import {
  countClicksForAffiliates,
  listAllAffiliates,
  rollupTotals,
} from "@/lib/affiliate/admin-data";
import { formatCents } from "@/lib/affiliate/dashboard-data";
import type { Affiliate } from "@/types/affiliate";

export const dynamic = "force-dynamic";

export default async function AdminAffiliatesPage() {
  if (LANDING_VARIANT !== "leadstack") notFound();
  const owner = await getCurrentAgencyOwner();
  if (!owner) notFound();

  const affiliates = await listAllAffiliates();
  const totals = rollupTotals(affiliates);
  const clicksByCode = await countClicksForAffiliates(affiliates);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Affiliate program
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every LeadStack buyer is auto-enrolled at 40% commission.
          </p>
        </div>
        <Link
          href="/agency/affiliates/payouts"
          className="inline-flex h-9 items-center rounded-lg border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted"
        >
          Payouts queue
          {totals.totalPendingCents > 0 && (
            <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
              {formatCents(totals.totalPendingCents)} owed
            </span>
          )}
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Affiliates" value={totals.affiliateCount.toString()} />
        <StatCard label="Referrals" value={totals.totalReferrals.toString()} />
        <StatCard
          label="Pending payouts"
          value={formatCents(totals.totalPendingCents)}
        />
        <StatCard
          label="Paid lifetime"
          value={formatCents(totals.totalPaidCents)}
        />
      </div>

      {affiliates.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-muted/30 p-12 text-center">
          <p className="text-sm font-medium">No affiliates yet</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Affiliate accounts are auto-created the first time someone
            completes a Founders purchase. As more buyers come in,
            they&apos;ll appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Affiliate</th>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 text-right font-medium">Clicks</th>
                <th className="px-4 py-3 text-right font-medium">Referrals</th>
                <th className="px-4 py-3 text-right font-medium">Pending</th>
                <th className="px-4 py-3 text-right font-medium">Paid</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {affiliates.map((a) => (
                <AffiliateRow
                  key={a.id}
                  affiliate={a}
                  clicks={clicksByCode.get(a.code) ?? 0}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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

function AffiliateRow({
  affiliate,
  clicks,
}: {
  affiliate: Affiliate;
  clicks: number;
}) {
  const statusClass =
    affiliate.status === "active"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : affiliate.status === "paused"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "bg-destructive/10 text-destructive";

  return (
    <tr className="border-t transition-colors hover:bg-muted/30">
      <td className="px-4 py-3">
        <Link
          href={`/agency/affiliates/${affiliate.id}`}
          className="font-medium underline-offset-2 hover:underline"
        >
          {affiliate.email}
        </Link>
        {affiliate.displayName && (
          <p className="text-xs text-muted-foreground">{affiliate.displayName}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {affiliate.code}
        </code>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">{clicks}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {affiliate.referralCount}
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">
        {formatCents(affiliate.pendingCommissionCents)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
        {formatCents(affiliate.paidCommissionCents)}
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}
        >
          {affiliate.status}
        </span>
      </td>
    </tr>
  );
}
