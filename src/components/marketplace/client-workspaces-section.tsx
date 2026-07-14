"use client";

/**
 * Client Workspaces — the white-label resell panel on the partner console.
 *
 * Lists the sub-accounts this partner has created for their own clients,
 * shows the tier allowance, and (when the tier allows) exposes a create
 * form. Everything goes through /api/partner/client-workspaces; the server
 * enforces tier capability + the allowance cap, so this component is
 * display + convenience only.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Briefcase, ExternalLink, Loader2, Plus, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

interface WorkspaceRow {
  subAccountId: string;
  accountNumber: number | null;
  name: string;
  whiteLabelBrandName: string | null;
  status: string;
  createdAt: string | null;
}

interface ListResponse {
  workspaces: WorkspaceRow[];
  limit: number;
  used: number;
  tier: string;
}

export function ClientWorkspacesSection() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Create form ----
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/partner/client-workspaces");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to load client workspaces.");
        return;
      }
      setData(body as ListResponse);
      setError(null);
    } catch {
      setError("Failed to load client workspaces.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      setCreateError("Workspace name is required.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/partner/client-workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          brandName: brandName.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError(body.error ?? "Create failed.");
        return;
      }
      setName("");
      setBrandName("");
      setShowForm(false);
      await load();
    } catch {
      setCreateError("Create failed. Check your connection and retry.");
    } finally {
      setCreating(false);
    }
  }

  const canCreate = (data?.limit ?? 0) > 0;
  const atCap = !!data && data.used >= data.limit;

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Client Workspaces
          </h2>
          {data && (
            <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
              {data.used} / {data.limit}
            </span>
          )}
        </div>

        {canCreate && !atCap && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            New workspace
          </button>
        )}
      </div>

      <p className="mb-4 text-xs text-muted-foreground">
        Spin up a CRM workspace for each of your clients under your own brand.
        You manage every workspace you create; invite your client from its
        Settings → Members page and they get their own login.
      </p>

      {loading && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading workspaces…
        </div>
      )}

      {!loading && error && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          {error}
        </p>
      )}

      {!loading && !error && data && !canCreate && (
        <div className="rounded-lg border border-dashed px-4 py-6 text-center">
          <p className="text-sm font-medium text-foreground">
            Client workspaces aren&apos;t included in your current tier.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upgrading your partner tier unlocks white-label workspaces you can
            resell to your own clients. Contact the agency owner to upgrade.
          </p>
        </div>
      )}

      {!loading && !error && data && canCreate && (
        <>
          {/* ---- Create form ---- */}
          {showForm && (
            <div className="mb-4 space-y-3 rounded-lg border bg-muted/30 p-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Workspace name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Smith Plumbing"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Your brand name (white-label)
                </label>
                <input
                  type="text"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="e.g. Peach State Leads"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Shown in the sidebar to everyone inside this workspace —
                  your client sees your brand. Leave blank for default
                  branding.
                </p>
              </div>
              {createError && (
                <p className="text-xs text-destructive">{createError}</p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Create workspace
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setCreateError(null);
                  }}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {atCap && !showForm && (
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              You&apos;ve used all {data.limit} workspace
              {data.limit === 1 ? "" : "s"} in your allowance. Ask the agency
              owner to raise it.
            </p>
          )}

          {/* ---- Workspace list ---- */}
          {data.workspaces.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center">
              <Briefcase className="h-7 w-7 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                No client workspaces yet.
              </p>
              <p className="text-xs text-muted-foreground">
                Create your first one and invite your client to it.
              </p>
            </div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {data.workspaces.map((w) => (
                <li
                  key={w.subAccountId}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {w.name}
                      {w.whiteLabelBrandName && (
                        <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                          {w.whiteLabelBrandName}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {w.accountNumber !== null
                        ? `Sub-account-${w.accountNumber}`
                        : w.subAccountId.slice(0, 8)}
                      <span
                        className={cn(
                          "ml-2 capitalize",
                          w.status === "active"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "",
                        )}
                      >
                        · {w.status}
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <Link
                      href={`/sa/${w.subAccountId}/dashboard/settings`}
                      className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <UserPlus className="h-3 w-3" />
                      Invite client
                    </Link>
                    <Link
                      href={`/sa/${w.subAccountId}/dashboard`}
                      className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
