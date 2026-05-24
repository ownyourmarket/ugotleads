import { notFound, redirect } from "next/navigation";
import { LANDING_VARIANT } from "@/config/landing";
import { getCurrentAffiliate } from "@/lib/affiliate/session";
import {
  formatCents,
  listReferralsForAffiliate,
} from "@/lib/affiliate/dashboard-data";
import { DashboardShell } from "@/components/affiliate/dashboard-shell";
import type { Referral, ReferralStatus } from "@/types/affiliate";
import type { Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<ReferralStatus, { label: string; className: string }> = {
  pending: {
    label: "Pending payout",
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

export default async function ConversionsPage() {
  if (LANDING_VARIANT !== "leadstack") notFound();

  const affiliate = await getCurrentAffiliate();
  if (!affiliate) redirect("/affiliate/login");

  const referrals = await listReferralsForAffiliate(affiliate.id);

  return (
    <DashboardShell activeTab="conversions" affiliateEmail={affiliate.email}>
      <div className="mx-auto max-w-4xl">
        <h1 className="text-xl font-semibold tracking-tight">Conversions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every founders purchase credited to your code{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {affiliate.code}
          </code>
          .
        </p>

        {referrals.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed bg-muted/30 p-12 text-center">
            <p className="text-sm font-medium">No conversions yet</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Once someone purchases LeadStack through your tracked link,
              they&apos;ll appear here within minutes.
            </p>
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-xl border">
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
    </DashboardShell>
  );
}

function ReferralRow({ referral }: { referral: Referral }) {
  const status = STATUS_LABELS[referral.status];
  return (
    <tr className="border-t">
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {formatTimestamp(referral.createdAt)}
      </td>
      <td className="px-4 py-3 font-medium">{maskEmail(referral.buyerEmail)}</td>
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

/**
 * Affiliates shouldn't see buyer emails in full — that would be a privacy
 * leak. Show only the first 2 chars + the domain.
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const masked = local.length <= 2 ? local : `${local.slice(0, 2)}***`;
  return `${masked}@${domain}`;
}
