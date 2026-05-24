"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import {
  Building2,
  Plus,
  ArrowRight,
  AlertCircle,
  Users,
  FlaskConical,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useAgency } from "@/hooks/use-agency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusTab } from "@/components/agency/status-tab";
import { LANDING_VARIANT } from "@/config/landing";

function ErrorBanner() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  if (error !== "no-access") return null;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
      <AlertCircle className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-400" />
      <div>
        <p className="font-medium">No access to that sub-account</p>
        <p className="text-muted-foreground">
          Pick one below or ask the agency owner for an invite.
        </p>
      </div>
    </div>
  );
}

function AgencyHomeContent() {
  const { user, loading, agencyId, agencyRole, memberships } = useAuth();
  const [filter, setFilter] = useState("");

  const visible = memberships.filter((m) =>
    m.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  const agency = useAgency();
  useEffect(() => {
    document.title = `Agency · ${agency.name}`;
  }, [agency.name]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-2xl bg-muted/50" />
      </div>
    );
  }

  if (!user || !agencyId) {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Sign in to view your agency.
        </p>
      </div>
    );
  }

  const isOwner = agencyRole === "owner";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agency</h1>
          <p className="text-sm text-muted-foreground">
            Switch into a sub-account or stand up a new one.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isOwner && LANDING_VARIANT === "leadstack" && (
            <>
              <Button
                variant="outline"
                render={<Link href="/agency/landing" />}
              >
                <FlaskConical className="mr-1 h-4 w-4" />
                A/B/C test
              </Button>
              <Button
                variant="outline"
                render={<Link href="/agency/affiliates" />}
              >
                <Users className="mr-1 h-4 w-4" />
                Affiliates
              </Button>
            </>
          )}
          {isOwner && (
            <Button render={<Link href="/agency/sub-accounts/new" />}>
              <Plus className="mr-1 h-4 w-4" />
              New sub-account
            </Button>
          )}
        </div>
      </div>

      <Suspense fallback={null}>
        <ErrorBanner />
      </Suspense>

      <Tabs defaultValue="sub-accounts">
        <TabsList>
          <TabsTrigger value="sub-accounts">Sub-accounts</TabsTrigger>
          {isOwner && <TabsTrigger value="status">Status</TabsTrigger>}
        </TabsList>

        <TabsContent value="sub-accounts" className="mt-4">
          <section className="rounded-2xl border bg-card p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <Building2 className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold">Your sub-accounts</h2>
                  <p className="text-xs text-muted-foreground">
                    {memberships.length} total
                  </p>
                </div>
              </div>
              {memberships.length > 4 && (
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter…"
                  className="h-8 w-48"
                />
              )}
            </div>

            {memberships.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-background p-6 text-center text-sm text-muted-foreground">
                You don&apos;t have access to any sub-accounts yet.
                {isOwner && (
                  <>
                    {" "}
                    <Link
                      href="/agency/sub-accounts/new"
                      className="text-primary underline"
                    >
                      Create one
                    </Link>{" "}
                    to get started.
                  </>
                )}
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((m) => (
                  <li key={m.subAccountId}>
                    <Link
                      href={`/sa/${m.subAccountId}/dashboard`}
                      className="group flex h-full flex-col justify-between gap-3 rounded-xl border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
                    >
                      <div>
                        <div className="flex items-baseline gap-2">
                          <p className="text-sm font-medium">
                            {m.name || "Untitled"}
                          </p>
                          {m.accountNumber !== undefined && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              #{m.accountNumber}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {m.role}
                        </p>
                      </div>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
                        Open <ArrowRight className="h-3 w-3" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>

        {isOwner && (
          <TabsContent value="status" className="mt-4">
            <StatusTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}


export default function AgencyHomePage() {
  return (
    <div className="mx-auto max-w-5xl">
      <AgencyHomeContent />
    </div>
  );
}
