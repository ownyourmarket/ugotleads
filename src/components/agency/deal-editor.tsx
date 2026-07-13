"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEAL_NAME_MAX,
  DEAL_MEMBER_NOUN_MAX,
  DEAL_SEATS_MIN,
  DEAL_SEATS_MAX,
  type DealConfig,
} from "@/lib/deal-config";

/**
 * Agency-owner editor for the live deal campaign — name, scarcity noun, and
 * seat count — with a preview of the pricing-card badge + scarcity counter.
 * Edits PATCH to /api/agency/deal-config (writes appConfig/foundersCohort)
 * and flow to the public landing via useFoundersCohort's onSnapshot — no
 * redeploy. The sold counter is Stripe-webhook-owned and deliberately not
 * editable here.
 */
export function DealEditor({
  initialConfig,
  soldCount,
}: {
  initialConfig: DealConfig;
  soldCount: number;
}) {
  const [draft, setDraft] = useState<DealConfig>(initialConfig);
  const [saved, setSaved] = useState<DealConfig>(initialConfig);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const nameEmpty = draft.dealName.trim().length === 0;
  const nounEmpty = draft.memberNoun.trim().length === 0;
  const canSave = dirty && !saving && !nameEmpty && !nounEmpty;

  const belowSold = draft.slotsTotal < soldCount;
  const remaining = Math.max(0, draft.slotsTotal - soldCount);
  const progressPct =
    draft.slotsTotal > 0
      ? Math.min(100, Math.round((soldCount / draft.slotsTotal) * 100))
      : 0;

  function set<K extends keyof DealConfig>(key: K, value: DealConfig[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function parseSeats(value: string): number {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < DEAL_SEATS_MIN) return DEAL_SEATS_MIN;
    return Math.min(n, DEAL_SEATS_MAX);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/agency/deal-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealName: draft.dealName.trim(),
          memberNoun: draft.memberNoun.trim(),
          slotsTotal: draft.slotsTotal,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Save failed.");
      const committed: DealConfig = {
        dealName: draft.dealName.trim(),
        memberNoun: draft.memberNoun.trim(),
        slotsTotal: draft.slotsTotal,
      };
      setDraft(committed);
      setSaved(committed);
      toast.success("Deal saved — live on the landing page.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="border-b bg-muted/30 px-5 py-3">
        <h2 className="text-sm font-semibold tracking-tight">Deal</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The current campaign shown across the landing page — hero counter,
          pricing card, announcement bar, CTAs, and FAQ. Changes go live
          immediately, no deploy. Prices ($891 / $1,782) stay in code so the
          display can&apos;t drift from what Stripe charges.
        </p>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-2">
        {/* Editor form */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="deal-name">Deal name</Label>
            <Input
              id="deal-name"
              value={draft.dealName}
              maxLength={DEAL_NAME_MAX}
              onChange={(e) => set("dealName", e.target.value)}
              placeholder="The New Era Deal"
            />
            {nameEmpty && (
              <p className="text-xs text-destructive">Deal name is required.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="deal-noun">Member noun (plural)</Label>
            <Input
              id="deal-noun"
              value={draft.memberNoun}
              maxLength={DEAL_MEMBER_NOUN_MAX}
              onChange={(e) => set("memberNoun", e.target.value)}
              placeholder="spots"
              className="w-48"
            />
            <p className="text-xs text-muted-foreground">
              Used in the scarcity counter: &quot;7 of 25{" "}
              <span className="font-medium">{draft.memberNoun.trim() || "spots"}</span>{" "}
              claimed&quot;.
            </p>
            {nounEmpty && (
              <p className="text-xs text-destructive">
                Member noun is required.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="deal-seats">Total seats</Label>
            <Input
              id="deal-seats"
              type="number"
              min={DEAL_SEATS_MIN}
              max={DEAL_SEATS_MAX}
              value={draft.slotsTotal}
              onChange={(e) => set("slotsTotal", parseSeats(e.target.value))}
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              Sold so far:{" "}
              <span className="font-medium text-foreground">{soldCount}</span>{" "}
              — driven by Stripe purchases. Starting a fresh campaign? Reset{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                appConfig/foundersCohort.soldCount
              </code>{" "}
              in the Firebase console; this editor never touches it.
            </p>
            {belowSold && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                New total is below the current sold count — the landing page
                will show the deal as sold out.
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button onClick={handleSave} disabled={!canSave} size="sm">
              {saving ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </Button>
            {dirty && !saving && (
              <span className="text-xs text-muted-foreground">
                Unsaved changes
              </span>
            )}
          </div>
        </div>

        {/* Preview — mirrors the pricing-card badge + scarcity counter */}
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Live preview
          </p>
          <div className="rounded-xl bg-background p-6 ring-1 ring-foreground/10">
            <div className="mx-auto max-w-sm space-y-5">
              <div className="flex justify-center">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                  <Zap className="h-3 w-3" />
                  {draft.dealName.trim() || "Deal name"} · {draft.slotsTotal}{" "}
                  spots only
                </span>
              </div>

              <p className="text-center text-2xl font-semibold tracking-tight text-violet-600 dark:text-violet-400">
                {draft.dealName.trim() || "Deal name"}
              </p>

              <div>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium">
                    {soldCount} of {draft.slotsTotal}{" "}
                    {draft.memberNoun.trim() || "spots"} claimed
                  </span>
                  {remaining > 0 && (
                    <span className="text-muted-foreground">
                      {remaining} left
                    </span>
                  )}
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-foreground/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500 transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
