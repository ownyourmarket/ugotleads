import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LANDING_VARIANT } from "@/config/landing";
import { getCurrentAgencyOwner } from "@/lib/auth/require-agency-owner";
import {
  getAffiliateById,
  listReferralsForAffiliateAdmin,
} from "@/lib/affiliate/admin-data";
import { countClicksForCode } from "@/lib/affiliate/clicks";
import { formatCents } from "@/lib/affiliate/dashboard-data";
import type { Referral, ReferralStatus } from "@/types/affiliate";
import type { Timestamp } from "firebase-admin/firestore";
import { AffiliateStatusControl } from "@/components/affiliate/admin-status-control";
import { MarkPaidButton } from "@/components/affiliate/admin-mark-paid-button";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATUS_LABELS: Record<ReferralStatus, { label: string; className: string }> = {
  pending: {
    label: "Pending",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  paid: {
    label: "Paid",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  voided: {
    label: "Voided",
    className: "bg-muted text-muted-foreground",
  },
};

export default async function AdminAffiliateDetailPage({ params }: PageProps) {
  if (LANDING_VARIANT !== "leadstack") notFound();
  const owner = await getCurrentAgencyOwner();
  if (!owner) notFound();

  const { id } = await params;
  const affiliate = await getAffiliateById(id);
  if (!affiliate) notFound();

  const [referrals, clickCount] = await Promise.all([
    listReferralsForAffiliateAdmin(id),
    countClicksForCode(affiliate.code),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <Link
        href="/agency/affiliates"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to all affiliates
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {affiliate.email}
          </h1>
          {affiliate.displayName && (
            <p className="mt-1 text-sm text-muted-foreground">
              {affiliate.displayName}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>
              Code:{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                {affiliate.code}
              </code>
            </span>
            <span>•</span>
            <span>{affiliate.commissionPct}% commission</span>
            <span>•</span>
            <span>Joined {formatTimestamp(affiliate.createdAt)}</span>
          </div>
        </div>
        <AffiliateStatusControl
          affiliateId={affiliate.id}
          currentStatus={affiliate.status}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Clicks" value={clickCount.toString()} />
        <StatCard label="Referrals" value={affiliate.referralCount.toString()} />
        <StatCard
          label="Pending"
          value={formatCents(affiliate.pendingCommissionCents)}
        />
        <StatCard
          label="Paid"
          value={formatCents(affiliate.paidCommissionCents)}
        />
      </div>

      <div>
        <h2 className="text-base font-semibold tracking-tight">Referrals</h2>
        {referrals.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
            No referrals yet.
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Buyer</th>
                  <th className="px-4 py-3 text-right font-medium">Sale</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Commission
                  </th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <ReferralRow key={r.id} referral={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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

function ReferralRow({ referral }: { referral: Referral }) {
  const status = STATUS_LABELS[referral.status];
  return (
    <tr className="border-t">
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {formatTimestamp(referral.createdAt)}
      </td>
      <td className="px-4 py-3 font-medium">{referral.buyerEmail}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {formatCents(referral.amountPaidCents)}
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">
        {formatCents(referral.commissionCents)}
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
        >
          {status.label}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        {referral.status === "pending" && (
          <MarkPaidButton referralId={referral.id} />
        )}
      </td>
    </tr>
  );
}

function formatTimestamp(value: Referral["createdAt"]): string {
  if (!value) return "—";
  const ts = value as Timestamp;
  if (typeof ts.toDate !== "function") return "—";
  return ts.toDate().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
