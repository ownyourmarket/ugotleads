import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LANDING_VARIANT } from "@/config/landing";
import { getCurrentAgencyOwner } from "@/lib/auth/require-agency-owner";
import { listPendingReferrals } from "@/lib/affiliate/admin-data";
import { formatCents } from "@/lib/affiliate/dashboard-data";
import { MarkPaidButton } from "@/components/affiliate/admin-mark-paid-button";
import type { Referral } from "@/types/affiliate";
import type { Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

export default async function AdminPayoutsPage() {
  if (LANDING_VARIANT !== "leadstack") notFound();
  const owner = await getCurrentAgencyOwner();
  if (!owner) notFound();

  const pending = await listPendingReferrals();
  const totalOwed = pending.reduce((sum, r) => sum + r.commissionCents, 0);

  // Group by affiliate code so the operator can batch one payout per
  // affiliate instead of one transfer per referral.
  const byAffiliate = new Map<
    string,
    { code: string; affiliateId: string; referrals: Referral[]; total: number }
  >();
  for (const r of pending) {
    const existing = byAffiliate.get(r.affiliateId);
    if (existing) {
      existing.referrals.push(r);
      existing.total += r.commissionCents;
    } else {
      byAffiliate.set(r.affiliateId, {
        code: r.affiliateCode,
        affiliateId: r.affiliateId,
        referrals: [r],
        total: r.commissionCents,
      });
    }
  }
  const groups = Array.from(byAffiliate.values()).sort(
    (a, b) => b.total - a.total,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <Link
        href="/agency/affiliates"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to all affiliates
      </Link>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Payouts queue
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All pending commissions, grouped by affiliate.
          </p>
        </div>
        <div className="rounded-xl border bg-card px-4 py-3 text-right">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Total owed
          </p>
          <p className="mt-0.5 text-2xl font-semibold tracking-tight">
            {formatCents(totalOwed)}
          </p>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-muted/30 p-12 text-center">
          <p className="text-sm font-medium">All caught up</p>
          <p className="mt-2 text-xs text-muted-foreground">
            No pending payouts. Referrals appear here automatically when a
            buyer arrives via an affiliate&apos;s tracked link.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.affiliateId} className="rounded-2xl border bg-card">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div>
                  <Link
                    href={`/agency/affiliates/${group.affiliateId}`}
                    className="text-sm font-medium underline-offset-2 hover:underline"
                  >
                    {group.referrals[0].buyerEmail.split("@")[1] === undefined
                      ? group.code
                      : group.code}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {group.referrals.length} pending referral
                    {group.referrals.length === 1 ? "" : "s"}
                  </p>
                </div>
                <p className="text-lg font-semibold tabular-nums">
                  {formatCents(group.total)}
                </p>
              </div>
              <ul className="divide-y">
                {group.referrals.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between px-5 py-3"
                  >
                    <div className="text-xs text-muted-foreground">
                      <span className="text-foreground font-medium">
                        {r.buyerEmail}
                      </span>{" "}
                      · {formatTimestamp(r.createdAt)}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium tabular-nums">
                        {formatCents(r.commissionCents)}
                      </span>
                      <MarkPaidButton referralId={r.id} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTimestamp(value: Referral["createdAt"]): string {
  if (!value) return "—";
  const ts = value as Timestamp;
  if (typeof ts.toDate !== "function") return "—";
  return ts.toDate().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
