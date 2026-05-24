"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { useSubAccount } from "@/context/sub-account-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Sub-account SMS settings panel.
 *
 * Collapsed-by-default disclosure: an "Enable a dedicated Twilio number"
 * toggle. When ON, reveals a credentials form (Account SID / Auth Token /
 * From Number) + a Save+Test button. On save we POST /api/sub-accounts/[id]/twilio
 * which validates creds with Twilio + best-effort sets the inbound webhook
 * URL on the operator's number.
 *
 * If auto-config of the inbound webhook fails, we surface a copy-button row
 * with the manual URL so the operator can paste it into their Twilio console.
 *
 * Disable flow: DELETE /api/sub-accounts/[id]/twilio sets enabled=false but
 * keeps the creds. Toggling back on is one click.
 */

export function SubAccountSmsSection() {
  const { subAccountId, subAccount, isAdmin } = useSubAccount();
  const cfg = subAccount?.twilioConfig ?? null;

  const [enabled, setEnabled] = useState<boolean>(!!cfg?.enabled);
  const [accountSid, setAccountSid] = useState(cfg?.accountSid ?? "");
  const [authToken, setAuthToken] = useState(""); // never reveal — write-only
  const [fromNumber, setFromNumber] = useState(cfg?.fromNumber ?? "");
  const [saving, setSaving] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [lastResult, setLastResult] = useState<{
    inboundWebhookConfigured: boolean;
    inboundWebhookError: string | null;
    friendlyName: string | null;
  } | null>(null);

  // Re-sync local state when the snapshot lands or the user navigates between
  // sub-accounts.
  useEffect(() => {
    setEnabled(!!cfg?.enabled);
    setAccountSid(cfg?.accountSid ?? "");
    setFromNumber(cfg?.fromNumber ?? "");
    setAuthToken("");
  }, [cfg?.enabled, cfg?.accountSid, cfg?.fromNumber, subAccountId]);

  const webhookUrl = useMemo(() => {
    const base =
      typeof window !== "undefined"
        ? window.location.origin
        : (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    return `${base}/api/webhooks/twilio/inbound`;
  }, []);

  if (!isAdmin) return null;

  const isExistingConfig = !!cfg && !!cfg.accountSid;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/sub-accounts/${subAccountId}/twilio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountSid: accountSid.trim(),
          authToken: authToken.trim(),
          fromNumber: fromNumber.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        friendlyName?: string | null;
        inboundWebhookConfigured?: boolean;
        inboundWebhookError?: string | null;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Failed to save Twilio config.");
      }
      setLastResult({
        friendlyName: data.friendlyName ?? null,
        inboundWebhookConfigured: !!data.inboundWebhookConfigured,
        inboundWebhookError: data.inboundWebhookError ?? null,
      });
      setAuthToken("");
      toast.success("Twilio connected. Dedicated SMS is live.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisable() {
    if (
      !confirm(
        "Disable dedicated SMS for this sub-account? Outbound sends will revert to the shared sender. Inbound replies stop being captured. Your Twilio creds stay saved so you can re-enable in one click.",
      )
    ) {
      return;
    }
    setDisabling(true);
    try {
      const res = await fetch(`/api/sub-accounts/${subAccountId}/twilio`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Failed to disable.");
      }
      setEnabled(false);
      toast.success("Dedicated SMS disabled. Reverted to shared sender.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disable.");
    } finally {
      setDisabling(false);
    }
  }

  function copyWebhook() {
    void navigator.clipboard.writeText(webhookUrl);
    toast.success("Webhook URL copied. Paste into Twilio's number config.");
  }

  return (
    <section className="rounded-2xl border bg-card p-6">
      <header className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
          <MessageSquare className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">SMS</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Use a dedicated Twilio number for this sub-account so customer
            replies land in a chat thread on each contact profile. Off by
            default — leave off to keep using the shared deployment-wide
            sender.
          </p>
        </div>
      </header>

      <label className="flex items-start gap-3 rounded-lg border bg-background p-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          disabled={saving || disabling}
          className="mt-0.5 h-4 w-4 cursor-pointer"
        />
        <div>
          <p className="text-sm font-medium">
            Use a dedicated Twilio number for this sub-account
          </p>
          <p className="text-xs text-muted-foreground">
            When on, outbound sends use the credentials below and inbound
            replies are routed to a chat thread on each contact.
          </p>
        </div>
      </label>

      {enabled && (
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="twilio-sid">Account SID</Label>
              <Input
                id="twilio-sid"
                value={accountSid}
                onChange={(e) => setAccountSid(e.target.value)}
                placeholder="AC…"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground">
                Twilio Console → Account Info.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="twilio-token">Auth Token</Label>
              <Input
                id="twilio-token"
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder={
                  isExistingConfig ? "•••••••••••••• (leave blank to keep)" : ""
                }
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground">
                Stored in Firestore. Never displayed back.
              </p>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="twilio-from">From Number</Label>
              <Input
                id="twilio-from"
                value={fromNumber}
                onChange={(e) => setFromNumber(e.target.value)}
                placeholder="+15551234567"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground">
                E.164 format. Must be a number this Twilio account owns.
              </p>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">
              Inbound webhook URL
            </p>
            <p className="mt-1">
              On save, we automatically point this number&apos;s inbound
              webhook here. If that fails (Twilio account permissions, etc.)
              paste this URL into the number&apos;s &ldquo;A MESSAGE COMES
              IN&rdquo; setting in the Twilio console:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-background px-2 py-1.5 text-[11px]">
                {webhookUrl}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={copyWebhook}
              >
                <Copy className="mr-1 h-3 w-3" />
                Copy
              </Button>
            </div>
          </div>

          {lastResult && (
            <div
              className={
                lastResult.inboundWebhookConfigured
                  ? "rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm"
                  : "rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
              }
            >
              {lastResult.inboundWebhookConfigured ? (
                <p className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Connected
                  {lastResult.friendlyName
                    ? ` — ${lastResult.friendlyName}`
                    : ""}
                  . Inbound webhook configured automatically.
                </p>
              ) : (
                <p className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Saved, but couldn&apos;t auto-configure the inbound
                    webhook:{" "}
                    {lastResult.inboundWebhookError ?? "unknown error"}.
                    Configure it manually using the URL above.
                  </span>
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              Saving validates the credentials with Twilio before they go live.
            </p>
            <div className="flex gap-2">
              {isExistingConfig && cfg?.enabled && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabling || saving}
                  onClick={handleDisable}
                >
                  {disabling ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Disable
                </Button>
              )}
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save & test"
                )}
              </Button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
