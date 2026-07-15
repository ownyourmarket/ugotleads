"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link2, Loader2, Plug, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { BrokerConnection } from "@/types/trading";

/**
 * Self-directed brokerage connections. The user links their OWN Alpaca
 * account — paper by default; live only when the agency has enabled it AND
 * the user opts in. The platform never places discretionary trades; this
 * connects the account so the user can run paper strategies and, later,
 * self-direct live trades themselves.
 *
 * Credentials are sent once and held by the trading service — never stored
 * in the CRM. We only render non-secret status here.
 */
export function BrokerSection({ subAccountId }: { subAccountId: string }) {
  const [connections, setConnections] = useState<BrokerConnection[]>([]);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/trading/broker`,
      );
      const data = await res.json();
      if (res.ok) {
        setConnections(data.connections ?? []);
        setLiveEnabled(!!data.liveEnabled);
      }
    } catch {
      // non-fatal — surface nothing; the workspace still works without a broker
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subAccountId]);

  async function disconnect(brokerId: string) {
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/trading/broker?brokerId=${encodeURIComponent(brokerId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Couldn't disconnect.");
        return;
      }
      toast.success("Broker disconnected.");
      load();
    } catch {
      toast.error("Network error — try again.");
    }
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <Plug className="h-5 w-5 text-primary" />
        <h2 className="font-semibold">Brokerage connection</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          Self-directed · your own account
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Connect your own Alpaca account to run paper strategies. When you&apos;re
        comfortable — and once live trading is enabled for this workspace —
        you can link a live account and place trades yourself. The agent never
        trades on your behalf, and your keys are never stored in the CRM.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {connections.length > 0 && (
            <ul className="space-y-2">
              {connections.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 rounded-lg border bg-background p-3 text-sm"
                >
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium capitalize">{c.provider}</span>
                  <Badge variant="outline" className="capitalize">
                    {c.mode}
                  </Badge>
                  {c.accountLabel && (
                    <span className="text-muted-foreground">
                      {c.accountLabel}
                    </span>
                  )}
                  <Badge
                    variant="secondary"
                    className={
                      c.connected
                        ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {c.connected ? "Connected" : "Pending"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-muted-foreground"
                    onClick={() => disconnect(c.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {showForm ? (
            <ConnectForm
              subAccountId={subAccountId}
              liveEnabled={liveEnabled}
              onDone={() => {
                setShowForm(false);
                load();
              }}
              onCancel={() => setShowForm(false)}
            />
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
              <Plug className="mr-1 h-4 w-4" />
              Connect a broker
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function ConnectForm({
  subAccountId,
  liveEnabled,
  onDone,
  onCancel,
}: {
  subAccountId: string;
  liveEnabled: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [apiKeyId, setApiKeyId] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const [saving, setSaving] = useState(false);

  async function connect() {
    if (!apiKeyId.trim() || !apiSecret.trim()) {
      toast.error("Enter both your API key id and secret.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/trading/broker`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, apiKeyId, apiSecret }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't connect the broker.");
        return;
      }
      toast.success(`Connected your ${mode} account.`);
      onDone();
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-background p-4">
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === "paper" ? "default" : "outline"}
          onClick={() => setMode("paper")}
        >
          Paper
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "live" ? "default" : "outline"}
          disabled={!liveEnabled}
          onClick={() => setMode("live")}
        >
          Live
        </Button>
        {!liveEnabled && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5" />
            Live trading isn&apos;t enabled for this workspace yet.
          </span>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiKeyId">Alpaca API key id</Label>
        <Input
          id="apiKeyId"
          value={apiKeyId}
          onChange={(e) => setApiKeyId(e.target.value)}
          placeholder="PK…"
          autoComplete="off"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="apiSecret">Alpaca secret key</Label>
        <Input
          id="apiSecret"
          type="password"
          value={apiSecret}
          onChange={(e) => setApiSecret(e.target.value)}
          placeholder="••••••••"
          autoComplete="off"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Your keys are sent once to the trading engine, which holds them
        securely. They&apos;re never stored in this CRM.
      </p>

      <div className="flex gap-2">
        <Button onClick={connect} disabled={saving} size="sm">
          {saving ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Plug className="mr-1 h-4 w-4" />
          )}
          Connect
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
