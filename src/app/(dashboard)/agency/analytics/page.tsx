"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

interface Summary {
  subAccountCount: number;
  totalContacts: number;
  totalDeals: number;
  totalTasks: number;
  totalForms: number;
  totalSocialPosts: number;
  totalReviews: number;
  totalReviewRequests: number;
  totalAiTokensThisPeriod: number;
}

interface SubAccountMetrics {
  id: string;
  name: string;
  socialPosts: number;
  reviews: number;
  reviewRequests: number;
  aiTokensUsed: number;
  aiTokensCap: number;
  aiLifetimeTokens: number;
}

export default function AgencyAnalyticsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [subAccounts, setSubAccounts] = useState<SubAccountMetrics[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/agency/analytics");
        const data = (await res.json()) as {
          summary?: Summary;
          perSubAccount?: SubAccountMetrics[];
          error?: string;
          message?: string;
        };
        if (!res.ok) {
          throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
        }
        setSummary(data.summary ?? null);
        setSubAccounts(data.perSubAccount ?? []);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load analytics");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) {
    return (
      <div className="container max-w-6xl py-8">
        <h1 className="text-2xl font-bold mb-4">Cross-Client Analytics</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-24 rounded-xl bg-muted" />
          <div className="h-64 rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="container max-w-6xl py-8">
        <h1 className="text-2xl font-bold mb-4">Cross-Client Analytics</h1>
        <p className="text-muted-foreground">No data available yet.</p>
      </div>
    );
  }

  const kpis = [
    { label: "Sub-accounts", value: summary.subAccountCount },
    { label: "Total contacts", value: summary.totalContacts.toLocaleString() },
    { label: "Total deals", value: summary.totalDeals.toLocaleString() },
    { label: "Social posts", value: summary.totalSocialPosts.toLocaleString() },
    { label: "Reviews", value: summary.totalReviews.toLocaleString() },
    { label: "Review requests", value: summary.totalReviewRequests.toLocaleString() },
    { label: "Forms", value: summary.totalForms.toLocaleString() },
    {
      label: "AI tokens (period)",
      value:
        summary.totalAiTokensThisPeriod >= 1_000_000
          ? `${(summary.totalAiTokensThisPeriod / 1_000_000).toFixed(1)}M`
          : summary.totalAiTokensThisPeriod.toLocaleString(),
    },
  ];

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cross-Client Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Aggregated performance across all your sub-accounts.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl border bg-card p-4 text-center"
          >
            <div className="text-2xl font-bold">{kpi.value}</div>
            <div className="text-xs text-muted-foreground">{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Per-sub-account breakdown */}
      <div className="rounded-xl border bg-card p-6 space-y-3">
        <h2 className="text-lg font-semibold">Per sub-account</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4 font-medium">Sub-account</th>
                <th className="py-2 px-3 font-medium text-right">Posts</th>
                <th className="py-2 px-3 font-medium text-right">Reviews</th>
                <th className="py-2 px-3 font-medium text-right">
                  Requests
                </th>
                <th className="py-2 px-3 font-medium text-right">
                  AI tokens
                </th>
                <th className="py-2 pl-3 font-medium text-right">
                  Cap usage
                </th>
              </tr>
            </thead>
            <tbody>
              {subAccounts.map((sa) => {
                const capPct =
                  sa.aiTokensCap > 0
                    ? Math.min(
                        100,
                        (sa.aiTokensUsed / sa.aiTokensCap) * 100,
                      )
                    : 0;
                return (
                  <tr key={sa.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{sa.name}</td>
                    <td className="py-2 px-3 text-right">{sa.socialPosts}</td>
                    <td className="py-2 px-3 text-right">{sa.reviews}</td>
                    <td className="py-2 px-3 text-right">
                      {sa.reviewRequests}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {sa.aiTokensUsed.toLocaleString()}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              capPct >= 90
                                ? "bg-red-500"
                                : capPct >= 70
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                            }`}
                            style={{ width: `${capPct}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-10 text-right">
                          {capPct.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
