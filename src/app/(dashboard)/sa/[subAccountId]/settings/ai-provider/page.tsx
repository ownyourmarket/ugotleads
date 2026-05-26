"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";

interface ProviderState {
  mode: "hosted" | "byok";
  byokKeyLast4: string | null;
  usage: {
    currentPeriodTokens: number;
    monthlyCapTokens: number;
    lifetimeTokens: number;
    currentPeriodStart: string;
    resetsAt: string;
  };
}

export default function AiProviderSettingsPage() {
  const { subAccountId } = useParams<{ subAccountId: string }>();
  const [state, setState] = useState<ProviderState | null>(null);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [validate, setValidate] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`/api/sub-accounts/${subAccountId}/ai-provider`);
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const data = (await res.json()) as ProviderState;
      setState(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't load AI provider config",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subAccountId]);

  async function switchToHosted() {
    setSaving(true);
    try {
      const res = await fetch(`/api/sub-accounts/${subAccountId}/ai-provider`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "hosted" }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { message?: string; error?: string };
        throw new Error(err.message ?? err.error ?? "switch failed");
      }
      toast.success("Switched to hosted AI (using included tier allowance)");
      setNewKey("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Switch failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveByokKey() {
    if (!newKey.trim()) {
      toast.error("Paste your OpenRouter key first.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/sub-accounts/${subAccountId}/ai-provider`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "byok", byokKey: newKey.trim(), validate }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { message?: string; error?: string };
        throw new Error(err.message ?? err.error ?? "save failed");
      }
      toast.success(
        validate
          ? "BYOK key validated + saved. Unlimited usage on your OpenRouter account."
          : "BYOK key saved. Unlimited usage on your OpenRouter account.",
      );
      setNewKey("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !state) {
    return (
      <div className="container max-w-3xl py-8">
        <h1 className="text-2xl font-bold mb-4">AI Provider</h1>
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Loading…
        </div>
      </div>
    );
  }

  const usagePct = Math.min(
    100,
    (state.usage.currentPeriodTokens / state.usage.monthlyCapTokens) * 100,
  );
  const resetsIn = msUntilHuman(
    new Date(state.usage.resetsAt).getTime() - Date.now(),
  );

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AI Provider</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose how this sub-account pays for AI replies + content generation.
        </p>
      </div>

      {/* Current mode card */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-muted-foreground">
              Current mode
            </div>
            <div className="text-xl font-semibold mt-1 flex items-center gap-2">
              {state.mode === "hosted" ? (
                <>
                  Hosted{" "}
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                    Included in your tier
                  </span>
                </>
              ) : (
                <>
                  BYOK{" "}
                  <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">
                    Your OpenRouter key · unlimited
                  </span>
                </>
              )}
            </div>
            {state.mode === "byok" && state.byokKeyLast4 && (
              <div className="text-xs text-muted-foreground mt-1">
                Key ends in <code>…{state.byokKeyLast4}</code>
              </div>
            )}
          </div>
        </div>

        {state.mode === "hosted" && (
          <div>
            <div className="flex items-baseline justify-between text-sm mb-1">
              <span className="text-muted-foreground">
                Tokens used this period
              </span>
              <span>
                {state.usage.currentPeriodTokens.toLocaleString()} /{" "}
                {state.usage.monthlyCapTokens.toLocaleString()}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  usagePct >= 95
                    ? "bg-red-500"
                    : usagePct >= 75
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
                style={{ width: `${usagePct.toFixed(1)}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              Resets in {resetsIn}. When the cap is reached, AI replies fall back
              to a friendly “someone will get back to you” message — no surprise
              bills. Upgrade your tier or switch to BYOK below to unblock.
            </div>
          </div>
        )}

        {state.mode === "byok" && (
          <div className="text-sm text-muted-foreground">
            You&apos;re using your own OpenRouter key. All AI calls hit your
            OpenRouter account — no cap, no markup. Lifetime tokens used through
            UGotLeads:{" "}
            <strong>{state.usage.lifetimeTokens.toLocaleString()}</strong>.
          </div>
        )}
      </div>

      {/* Switcher */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div>
          <div className="text-base font-semibold">
            {state.mode === "hosted" ? "Switch to BYOK" : "Switch to Hosted"}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {state.mode === "hosted"
              ? "Bring your own OpenRouter key for unlimited usage. We send every AI call from your key; nothing routes through ours."
              : "Use the AI allowance included with your tier. We pay OpenRouter; your usage is capped by your tier."}
          </div>
        </div>

        {state.mode === "hosted" ? (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium" htmlFor="byok-key">
                OpenRouter API key
              </label>
              <input
                id="byok-key"
                type="password"
                placeholder="sk-or-…"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                disabled={saving}
                className="mt-1 w-full h-10 px-3 rounded-md border bg-background font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Get one at{" "}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  openrouter.ai/keys
                </a>
                . Stored encrypted (Phase 1: plaintext — encryption coming).
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={validate}
                onChange={(e) => setValidate(e.target.checked)}
                disabled={saving}
              />
              Validate the key with a 1-token test call before saving (recommended)
            </label>
            <button
              type="button"
              onClick={saveByokKey}
              disabled={saving || !newKey.trim()}
              className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save BYOK key + switch"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={switchToHosted}
            disabled={saving}
            className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Switching…" : "Switch back to Hosted"}
          </button>
        )}
      </div>
    </div>
  );
}

function msUntilHuman(ms: number): string {
  if (ms <= 0) return "soon";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 2) return `${days} days`;
  if (days === 1) return "1 day";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 2) return `${hours} hours`;
  return "under an hour";
}
