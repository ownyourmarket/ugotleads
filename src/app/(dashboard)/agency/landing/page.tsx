import { notFound } from "next/navigation";
import { LANDING_VARIANT } from "@/config/landing";
import { getCurrentAgencyOwner } from "@/lib/auth/require-agency-owner";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  HERO_VARIANTS,
  HERO_VARIANT_IDS,
  type HeroVariantId,
} from "@/lib/hero-variants";

export const dynamic = "force-dynamic";

interface VariantRow {
  id: HeroVariantId;
  label: string;
  pageViews: number;
  ctaClicks: number;
  conversionPct: number | null;
}

export default async function LandingAbTestPage() {
  if (LANDING_VARIANT !== "leadstack") notFound();
  const owner = await getCurrentAgencyOwner();
  if (!owner) notFound();

  const snap = await getAdminDb().doc("appConfig/landingMetrics").get();
  const data = (snap.data() ?? {}) as Record<string, unknown>;

  const totalPageViews =
    typeof data.pageViews === "number" ? data.pageViews : 0;
  const totalCtaClicks =
    typeof data.ctaClicks === "number" ? data.ctaClicks : 0;

  const rows: VariantRow[] = HERO_VARIANT_IDS.map((id) => {
    const pv = data[`pageViews_${id}`];
    const cc = data[`ctaClicks_${id}`];
    const pageViews = typeof pv === "number" ? pv : 0;
    const ctaClicks = typeof cc === "number" ? cc : 0;
    const conversionPct =
      pageViews > 0 ? +((ctaClicks / pageViews) * 100).toFixed(1) : null;
    return {
      id,
      label: HERO_VARIANTS[id].label,
      pageViews,
      ctaClicks,
      conversionPct,
    };
  });

  // Winner = variant with the highest conversion rate AND at least 30 page
  // views (avoids declaring a winner on a single lucky click). At meaningful
  // scale you'd want a proper significance test; this is just a directional
  // signal for the operator.
  const eligibleForWinner = rows.filter((r) => r.pageViews >= 30 && r.conversionPct !== null);
  const winner =
    eligibleForWinner.length > 0
      ? eligibleForWinner.reduce((a, b) =>
          (b.conversionPct ?? 0) > (a.conversionPct ?? 0) ? b : a,
        )
      : null;

  const overallConversion =
    totalPageViews > 0
      ? +((totalCtaClicks / totalPageViews) * 100).toFixed(1)
      : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Landing A/B/C test
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Each visitor is randomly assigned one of three hero copy variants,
          cookie-pinned for 90 days. Conversion = primary CTA click ÷ unique
          page views (per browser session).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total page views" value={totalPageViews.toLocaleString()} />
        <StatCard label="Total CTA clicks" value={totalCtaClicks.toLocaleString()} />
        <StatCard
          label="Overall conversion"
          value={overallConversion !== null ? `${overallConversion}%` : "—"}
        />
      </div>

      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Variant</th>
              <th className="px-4 py-3 font-medium">Hypothesis</th>
              <th className="px-4 py-3 text-right font-medium">Page views</th>
              <th className="px-4 py-3 text-right font-medium">CTA clicks</th>
              <th className="px-4 py-3 text-right font-medium">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isWinner = winner?.id === row.id;
              return (
                <tr
                  key={row.id}
                  className={`border-t ${isWinner ? "bg-emerald-500/5" : ""}`}
                >
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {row.id}
                      </code>
                      {isWinner && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                          Leading
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.label}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.pageViews.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.ctaClicks.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {row.conversionPct !== null
                      ? `${row.conversionPct}%`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border bg-muted/20 p-5 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Interpreting the data:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            &quot;Leading&quot; is shown for the variant with the highest
            conversion rate once it has ≥30 page views — directional only,
            not statistically significant.
          </li>
          <li>
            For a meaningful test you generally want ≥1,000 views per variant
            (so ~3,000 total) before declaring a real winner.
          </li>
          <li>
            CTA click ≠ purchase. To measure true purchase conversion, cross-
            reference these with the affiliate program data (a purchase
            writes a row to <code>purchases/&#123;sessionId&#125;</code> with
            metadata you can join on).
          </li>
        </ul>
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
