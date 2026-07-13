"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PLAN_GATE_KEYS,
  PLAN_GATE_LABELS,
  type BillingPlanResponse,
  type PlanGates,
} from "@/types/billing";

/**
 * Create / edit one billing plan (Client Billing v1). A plan is a monthly
 * price + the bundle of feature gates it switches on. Currency is fixed
 * after creation (Stripe prices are single-currency); price edits mint a
 * new Stripe price — existing subscribers stay on what they signed up at.
 */

const CURRENCIES = ["usd", "aud", "eur", "gbp", "cad", "nzd"] as const;

/**
 * The AI-channel gates that default ON platform-wide (opt-out) because the
 * features pre-existed agency gating. A new plan pre-includes them so building
 * a plan doesn't silently LOCK a channel that's otherwise on by default — the
 * agency unchecks to exclude. Every other gate is opt-in (starts unbundled).
 * Keep in sync with the `defaultOn` channels in lib/comms/ai/gates.ts.
 */
const DEFAULT_ON_PLAN_GATES: ReadonlySet<string> = new Set([
  "smsAgentEnabledByAgency",
  "webChatEnabledByAgency",
  "inboundVoiceEnabledByAgency",
]);

function defaultGates(): PlanGates {
  const gates = {} as PlanGates;
  for (const key of PLAN_GATE_KEYS) {
    gates[key] = DEFAULT_ON_PLAN_GATES.has(key);
  }
  return gates;
}

interface Props {
  /** null = create mode. */
  plan: BillingPlanResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function PlanEditorDialog({ plan, open, onOpenChange, onSaved }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceDollars, setPriceDollars] = useState("");
  const [annualPriceDollars, setAnnualPriceDollars] = useState("");
  const [currency, setCurrency] = useState<string>("usd");
  const [gates, setGates] = useState<PlanGates>(defaultGates);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(plan?.name ?? "");
    setDescription(plan?.description ?? "");
    setPriceDollars(
      plan ? (plan.priceMonthlyCents / 100).toFixed(2).replace(/\.00$/, "") : "",
    );
    setAnnualPriceDollars(
      plan?.priceAnnualCents != null
        ? (plan.priceAnnualCents / 100).toFixed(2).replace(/\.00$/, "")
        : "",
    );
    setCurrency(plan?.currency ?? "usd");
    setGates(plan ? { ...plan.gates } : defaultGates());
  }, [open, plan]);

  const priceCents = useMemo(() => {
    const parsed = Number.parseFloat(priceDollars);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(parsed * 100);
  }, [priceDollars]);

  // Optional annual price. Blank = monthly-only (null). Invalid (non-positive)
  // is treated as blank so a stray keystroke doesn't block the save.
  const annualPriceCents = useMemo(() => {
    const trimmed = annualPriceDollars.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(parsed * 100);
  }, [annualPriceDollars]);

  const gateCount = PLAN_GATE_KEYS.filter((k) => gates[k]).length;
  const canSave = !!name.trim() && priceCents !== null && !saving;

  async function handleSave() {
    if (!canSave || priceCents === null) return;
    setSaving(true);
    try {
      const body = plan
        ? {
            name: name.trim(),
            description: description.trim() || null,
            priceMonthlyCents: priceCents,
            // null removes annual; a number sets/changes it.
            priceAnnualCents: annualPriceCents,
            gates,
          }
        : {
            name: name.trim(),
            description: description.trim() || null,
            priceMonthlyCents: priceCents,
            priceAnnualCents: annualPriceCents,
            currency,
            gates,
          };
      const res = await fetch(
        plan ? `/api/agency/plans/${plan.id}` : "/api/agency/plans",
        {
          method: plan ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save the plan.");
      toast.success(plan ? "Plan updated." : "Plan created.");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save the plan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{plan ? `Edit ${plan.name}` : "New plan"}</DialogTitle>
          <DialogDescription>
            A plan bundles a monthly price with the features it unlocks.
            Assign it to a client from Sub-accounts → Manage → Billing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Plan name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Pro"
                maxLength={60}
                disabled={saving}
              />
            </div>
            <div className="sm:col-span-2">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Monthly price
                  </label>
                  <Input
                    value={priceDollars}
                    onChange={(e) => setPriceDollars(e.target.value)}
                    placeholder="297"
                    inputMode="decimal"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Annual (optional)
                  </label>
                  <Input
                    value={annualPriceDollars}
                    onChange={(e) => setAnnualPriceDollars(e.target.value)}
                    placeholder="e.g. 2970"
                    inputMode="decimal"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Currency{plan ? " (fixed)" : ""}
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    disabled={saving || !!plan}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 [&_option]:bg-background [&_option]:text-foreground"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Leave annual blank for monthly-only. You set the annual amount
                directly (e.g. 10× the monthly price = &ldquo;2 months
                free&rdquo;). Same currency as monthly. The agency picks monthly
                or annual when assigning the plan to a client.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Description (optional)
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Everything in Starter plus broadcasts + workflows"
                maxLength={300}
                disabled={saving}
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Included features ({gateCount} of {PLAN_GATE_KEYS.length})
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {PLAN_GATE_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors hover:bg-muted/40"
                >
                  <input
                    type="checkbox"
                    checked={gates[key]}
                    onChange={(e) =>
                      setGates((prev) => ({ ...prev, [key]: e.target.checked }))
                    }
                    disabled={saving}
                    className="h-4 w-4 cursor-pointer"
                  />
                  <span className="min-w-0 truncate">{PLAN_GATE_LABELS[key]}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Core CRM (contacts, pipeline, calendar, tasks, forms, quotes) is
              always included. Gate changes re-apply automatically to every
              client currently on this plan.
              {plan &&
                " Price changes only affect new checkouts — existing subscribers keep their current price."}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {saving ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : plan ? (
              "Save changes"
            ) : (
              "Create plan"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
