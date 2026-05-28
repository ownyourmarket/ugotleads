"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  Building2,
  Users,
  TrendingUp,
  Trophy,
  ArrowRight,
  Plus,
  Sparkles,
  GitBranch,
  Clock,
  FileText,
  Mail,
  Phone,
  Upload,
  Download,
  Zap,
  CheckCircle2,
  Circle,
  CalendarCheck,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
} from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { getFirebaseDb } from "@/lib/firebase/client";
import { subscribeToContacts } from "@/lib/firestore/contacts";
import { subscribeToDeals } from "@/lib/firestore/deals";
import { subscribeToForms } from "@/lib/firestore/forms";
import { subscribeToTasks, setTaskCompleted } from "@/lib/firestore/tasks";
import { subscribeToEvents } from "@/lib/firestore/events";
import { formatCurrency, daysSince, toDate } from "@/lib/format";
import type { Task } from "@/types/tasks";
import type { CalendarEvent } from "@/types/events";
import { getStage, PIPELINE_STAGES, type Deal } from "@/types/deals";
import type { Contact } from "@/types/contacts";
import type { AutomationDoc, ExecutionDoc } from "@/types";
import type { LeadForm } from "@/types/forms";
import { Button } from "@/components/ui/button";
import { NewDealDialog } from "@/components/pipeline/new-deal-dialog";
import { LeadsMap } from "@/components/dashboard/leads-map";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";

export default function DashboardPage() {
  const { user } = useAuth();
  const { subAccount, subAccountId, agencyId, saPath } = useSubAccount();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [forms, setForms] = useState<LeadForm[]>([]);
  const [automations, setAutomations] = useState<AutomationDoc[]>([]);
  const [hasAiAgent, setHasAiAgent] = useState(false);
  const [hasSocialConnection, setHasSocialConnection] = useState(false);
  const [hasBroadcast, setHasBroadcast] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([]);
  const [recentExecutions, setRecentExecutions] = useState<ExecutionDoc[]>([]);
  const [execContactNames, setExecContactNames] = useState<Record<string, string>>({});
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !agencyId) return;
    const scope = { agencyId, subAccountId };
    let dealsReady = false;
    let contactsReady = false;
    const settle = () => {
      if (dealsReady && contactsReady) setLoading(false);
    };
    const unsubC = subscribeToContacts(scope, (l) => {
      setContacts(l);
      contactsReady = true;
      settle();
    });
    const unsubD = subscribeToDeals(scope, (l) => {
      setDeals(l);
      dealsReady = true;
      settle();
    });
    const unsubF = subscribeToForms(scope, setForms);
    const unsubT = subscribeToTasks(scope, setTasks);
    const unsubEv = subscribeToEvents(scope, setCalEvents);
    const automationsQ = query(
      collection(getFirebaseDb(), "automations"),
      where("subAccountId", "==", subAccountId),
    );
    const unsubA = onSnapshot(automationsQ, (snap) => {
      setAutomations(snap.docs.map((d) => d.data() as AutomationDoc));
    });
    return () => {
      unsubC();
      unsubD();
      unsubF();
      unsubT();
      unsubEv();
      unsubA();
    };
  }, [user, agencyId, subAccountId]);

  // Setup checklist: load dismissed state from localStorage
  useEffect(() => {
    const key = `ugotleads-setup-dismissed-${subAccountId}`;
    setSetupDismissed(localStorage.getItem(key) === "true");
  }, [subAccountId]);

  // Setup checklist: subscribe to AI agent profile, social connections, broadcasts
  useEffect(() => {
    if (!user) return;
    const db = getFirebaseDb();

    const unsubAi = onSnapshot(
      doc(db, `subAccounts/${subAccountId}/aiAgent/profile`),
      (snap) => {
        const data = snap.data();
        setHasAiAgent(!!data?.systemPrompt);
      },
      () => setHasAiAgent(false),
    );

    const unsubSocial = onSnapshot(
      query(collection(db, `subAccounts/${subAccountId}/socialConnections`), limit(1)),
      (snap) => setHasSocialConnection(!snap.empty),
      () => setHasSocialConnection(false),
    );

    const broadcastsQ = query(
      collection(db, "broadcasts"),
      where("subAccountId", "==", subAccountId),
      limit(1),
    );
    const unsubBroadcast = onSnapshot(
      broadcastsQ,
      (snap) => setHasBroadcast(!snap.empty),
      () => setHasBroadcast(false),
    );

    const execQ = query(
      collection(db, "automation_executions"),
      where("subAccountId", "==", subAccountId),
      orderBy("startedAt", "desc"),
      limit(5),
    );
    const unsubExec = onSnapshot(
      execQ,
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as ExecutionDoc);
        setRecentExecutions(rows);
        // Lazy-load contact names
        for (const e of rows) {
          if (execContactNames[e.contactId]) continue;
          void getDoc(doc(db, "contacts", e.contactId))
            .then((s) => {
              if (s.exists()) {
                const c = s.data() as Partial<Contact>;
                setExecContactNames((prev) => ({
                  ...prev,
                  [e.contactId]:
                    c.name?.trim() || c.email?.trim() || `Contact ${e.contactId.slice(0, 6)}`,
                }));
              }
            })
            .catch(() => {});
        }
      },
      () => {},
    );

    return () => {
      unsubAi();
      unsubSocial();
      unsubBroadcast();
      unsubExec();
    };
  }, [user, subAccountId]);

  const handleDismissSetup = () => {
    setSetupDismissed(true);
    localStorage.setItem(`ugotleads-setup-dismissed-${subAccountId}`, "true");
  };

  const displayName = (user?.displayName ?? user?.email ?? "").split("@")[0];

  const openDeals = useMemo(
    () => deals.filter((d) => d.stageId !== "won" && d.stageId !== "lost"),
    [deals],
  );
  const currency = deals[0]?.currency ?? "USD";
  const pipelineValue = openDeals.reduce((s, d) => s + (d.value || 0), 0);
  const wonThisMonth = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(1);
    cutoff.setHours(0, 0, 0, 0);
    return deals
      .filter((d) => d.stageId === "won")
      .filter((d) => {
        const date = toDate(d.stageChangedAt);
        return date && date.getTime() >= cutoff.getTime();
      })
      .reduce((s, d) => s + (d.value || 0), 0);
  }, [deals]);
  const newContactsThisWeek = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return contacts.filter((c) => {
      const d = toDate(c.createdAt);
      return d && d.getTime() >= cutoff;
    }).length;
  }, [contacts]);

  const contactById = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) m.set(c.id, c);
    return m;
  }, [contacts]);

  const recentDeals = openDeals.slice(0, 5);
  const recentContacts = [...contacts]
    .sort(
      (a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0),
    )
    .slice(0, 5);

  // Today's agenda — tasks due today + overdue, events today
  const todayAgenda = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayEnd = todayStart + 24 * 60 * 60 * 1000;

    const dueTasks = tasks.filter((t) => {
      if (t.completed) return false;
      const d = toDate(t.dueAt);
      if (!d) return false;
      return d.getTime() < todayEnd; // due today or overdue
    });

    const todayEvents = calEvents.filter((e) => {
      const d = toDate(e.startAt);
      if (!d) return false;
      return d.getTime() >= todayStart && d.getTime() < todayEnd;
    });

    return { dueTasks, todayEvents };
  }, [tasks, calEvents]);

  const stageCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of PIPELINE_STAGES) m.set(s.id, 0);
    for (const d of deals) m.set(d.stageId, (m.get(d.stageId) ?? 0) + 1);
    return m;
  }, [deals]);
  const maxStageCount = Math.max(1, ...Array.from(stageCounts.values()));

  const isEmpty = !loading && contacts.length === 0 && deals.length === 0;
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const accountContact = subAccount?.accountContact ?? null;
  const hasContact =
    !!accountContact &&
    (!!accountContact.name || !!accountContact.email || !!accountContact.phone);

  return (
    <div className="space-y-6">
      {!setupDismissed && (
        <SetupChecklist
          subAccountId={subAccountId}
          contactCount={contacts.length}
          dealCount={deals.length}
          formCount={forms.length}
          hasAiAgent={hasAiAgent}
          hasSocialConnection={hasSocialConnection}
          hasAutomation={automations.length > 0}
          hasBroadcast={hasBroadcast}
          dismissed={setupDismissed}
          onDismiss={handleDismissSetup}
        />
      )}

      {hasContact && accountContact && (
        <Link
          href={saPath("/dashboard/settings")}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
        >
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <Building2 className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
            Account contact
          </span>
          {accountContact.name && <span>{accountContact.name}</span>}
          {accountContact.email && (
            <span className="inline-flex items-center gap-1">
              <Mail className="h-3 w-3" />
              {accountContact.email}
            </span>
          )}
          {accountContact.phone && (
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {accountContact.phone}
            </span>
          )}
        </Link>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {today}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tighter sm:text-4xl">
            Welcome back
            {displayName ? (
              <>
                , <span className="font-serif font-normal italic">{displayName}</span>
              </>
            ) : null}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s what&apos;s moving in your pipeline.
          </p>
        </div>
        {!isEmpty && (
          <div className="flex items-center gap-2">
            <NewDealDialog contacts={contacts} />
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          href={saPath("/pipeline")}
          icon={<Briefcase className="h-4 w-4" />}
          label="Open deals"
              value={String(openDeals.length)}
              hint={`${deals.length - openDeals.length} closed`}
              tone="text-indigo-600 dark:text-indigo-400"
              bg="bg-indigo-500/10"
              loading={loading}
            />
            <StatCard
              href={saPath("/pipeline")}
              icon={<TrendingUp className="h-4 w-4" />}
              label="Pipeline value"
              value={formatCurrency(pipelineValue, currency)}
              hint="Across open stages"
              tone="text-violet-600 dark:text-violet-400"
              bg="bg-violet-500/10"
              loading={loading}
            />
            <StatCard
              href={saPath("/pipeline")}
              icon={<Trophy className="h-4 w-4" />}
              label="Won this month"
              value={formatCurrency(wonThisMonth, currency)}
              hint="Closed-won revenue"
              tone="text-emerald-600 dark:text-emerald-400"
              bg="bg-emerald-500/10"
              loading={loading}
            />
            <StatCard
              href={saPath("/contacts")}
              icon={<Users className="h-4 w-4" />}
              label="New contacts · 7d"
              value={String(newContactsThisWeek)}
              hint={`${contacts.length} total`}
              tone="text-amber-600 dark:text-amber-400"
              bg="bg-amber-500/10"
              loading={loading}
            />
            <StatCard
              href={saPath("/forms")}
              icon={<FileText className="h-4 w-4" />}
              label="Forms"
              value={String(forms.length)}
              hint="Public + embeddable"
              tone="text-sky-600 dark:text-sky-400"
              bg="bg-sky-500/10"
              loading={loading}
            />
            <StatCard
              href={saPath("/automations")}
              icon={<Zap className="h-4 w-4" />}
              label="Automations"
              value={
                subAccount?.automationsPaused
                  ? "Paused"
                  : String(automations.filter((a) => a.enabled).length)
              }
              hint={
                subAccount?.automationsPaused
                  ? `${automations.length} affected`
                  : `${automations.length} total`
              }
              tone={
                subAccount?.automationsPaused
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-rose-600 dark:text-rose-400"
              }
              bg={
                subAccount?.automationsPaused
                  ? "bg-amber-500/10"
                  : "bg-rose-500/10"
              }
              loading={loading}
            />
          </div>

      <LeadsMap contacts={contacts} deals={deals} />

      {/* Today's agenda */}
      {!loading && (todayAgenda.dueTasks.length > 0 || todayAgenda.todayEvents.length > 0) && (
        <section className="rounded-2xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-4 w-4 text-indigo-500" />
              <h2 className="text-sm font-semibold">Today&apos;s agenda</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {todayAgenda.dueTasks.length + todayAgenda.todayEvents.length} item{todayAgenda.dueTasks.length + todayAgenda.todayEvents.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex gap-1.5">
              <Button
                render={<Link href={saPath("/tasks")} />}
                size="sm"
                variant="ghost"
                className="gap-1 text-xs"
              >
                Tasks <ArrowRight className="h-3 w-3" />
              </Button>
              <Button
                render={<Link href={saPath("/calendar")} />}
                size="sm"
                variant="ghost"
                className="gap-1 text-xs"
              >
                Calendar <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {todayAgenda.dueTasks.map((task) => {
              const due = toDate(task.dueAt);
              const isOverdue = due && due.getTime() < new Date().setHours(0, 0, 0, 0);
              const c = task.contactId ? contactById.get(task.contactId) : null;
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={async () => {
                    if (!user) return;
                    try {
                      await setTaskCompleted(task, true, user.uid);
                    } catch {}
                  }}
                  className="flex items-center gap-3 rounded-lg border bg-background p-3 text-left transition-all hover:border-primary/40 hover:shadow-sm"
                  title="Click to mark done"
                >
                  <Circle className={`h-4 w-4 shrink-0 ${isOverdue ? "text-rose-500" : "text-amber-500"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{task.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {isOverdue ? "Overdue" : "Due today"}
                      {c ? ` · ${c.name || c.email || ""}` : ""}
                    </p>
                  </div>
                </button>
              );
            })}
            {todayAgenda.todayEvents.map((ev) => {
              const start = toDate(ev.startAt);
              const c = ev.contactId ? contactById.get(ev.contactId) : null;
              return (
                <Link
                  key={ev.id}
                  href={saPath("/calendar")}
                  className="flex items-center gap-3 rounded-lg border bg-background p-3 transition-all hover:border-primary/40 hover:shadow-sm"
                >
                  <span className="h-4 w-4 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{ev.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {start
                        ? start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                        : "All day"}
                      {c ? ` · ${c.name || ""}` : ""}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {isEmpty ? (
        <GettingStarted />
      ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <section className="rounded-2xl border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Pipeline snapshot</h2>
                  <p className="text-xs text-muted-foreground">
                    Deals by stage — click to open the board.
                  </p>
                </div>
                <Button
                  render={<Link href={saPath("/pipeline")} />}
                  size="sm"
                  variant="ghost"
                  className="gap-1"
                >
                  Open <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
              <div className="space-y-2">
                {PIPELINE_STAGES.map((s) => {
                  const count = stageCounts.get(s.id) ?? 0;
                  const pct = (count / maxStageCount) * 100;
                  return (
                    <Link
                      key={s.id}
                      href={saPath("/pipeline")}
                      className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50"
                    >
                      <span
                        className={`w-24 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-medium ${s.tone}`}
                      >
                        {s.label}
                      </span>
                      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
                        {count}
                      </span>
                    </Link>
                  );
                })}
              </div>

              {recentDeals.length > 0 && (
                <>
                  <div className="my-4 border-t" />
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Most recent open deals
                    </h3>
                  </div>
                  <ul className="space-y-1">
                    {recentDeals.map((d) => {
                      const stage = getStage(d.stageId);
                      const c = contactById.get(d.contactId);
                      const days = daysSince(d.stageChangedAt);
                      return (
                        <li key={d.id}>
                          <Link
                            href={saPath("/pipeline")}
                            className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/50"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <Briefcase className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <div className="min-w-0">
                                <p className="truncate font-medium">{d.title}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {c?.name ?? "Unknown"} ·{" "}
                                  {formatCurrency(d.value, d.currency)}
                                </p>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                {days}d
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${stage.tone}`}
                              >
                                {stage.label}
                              </span>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </section>

            <div className="space-y-4">
              <section className="rounded-2xl border bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">Recent contacts</h2>
                    <p className="text-xs text-muted-foreground">
                      Newest leads in your list.
                    </p>
                  </div>
                  <Button
                    render={<Link href={saPath("/contacts")} />}
                    size="sm"
                    variant="ghost"
                    className="gap-1"
                  >
                    View all <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
                {recentContacts.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    No contacts yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {recentContacts.map((c) => {
                      const initials = (c.name || c.email || "?")
                        .split(" ")
                        .map((s) => s[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase();
                      return (
                        <li key={c.id}>
                          <Link
                            href={saPath(`/contacts/${c.id}`)}
                            className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/50"
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400/80 via-violet-400/80 to-pink-400/80 text-[10px] font-semibold text-white">
                              {initials}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">
                                {c.name || "Unnamed"}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {c.email || c.company || "—"}
                              </p>
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              {daysSince(c.createdAt)}d
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {recentExecutions.length > 0 && (
                <section className="rounded-2xl border bg-card p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-semibold">Automation activity</h2>
                      <p className="text-xs text-muted-foreground">
                        Latest executions across your recipes.
                      </p>
                    </div>
                    <Button
                      render={<Link href={saPath("/automations/activity")} />}
                      size="sm"
                      variant="ghost"
                      className="gap-1"
                    >
                      View all <ArrowRight className="h-3 w-3" />
                    </Button>
                  </div>
                  <ul className="space-y-1">
                    {recentExecutions.map((e) => {
                      const name = execContactNames[e.contactId] ?? "…";
                      const started = toDate(e.startedAt);
                      const stepsRun = e.history?.length ?? 0;
                      const statusColor =
                        e.status === "completed"
                          ? "bg-emerald-500"
                          : e.status === "running"
                            ? "bg-amber-500"
                            : e.status === "failed"
                              ? "bg-rose-500"
                              : "bg-muted-foreground";
                      return (
                        <li key={e.id}>
                          <Link
                            href={saPath("/automations/activity")}
                            className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/50"
                          >
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${statusColor}`}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{name}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {stepsRun} step{stepsRun === 1 ? "" : "s"} ·{" "}
                                {e.status}
                              </p>
                            </div>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {started
                                ? started.toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                  })
                                : "Pending"}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              <section className="rounded-2xl border bg-gradient-to-br from-indigo-500/5 via-violet-500/5 to-pink-500/5 p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-violet-500" />
                  <h2 className="text-sm font-semibold">Quick actions</h2>
                </div>
                <div className="grid gap-2">
                  <QuickLink
                    href={saPath("/contacts")}
                    icon={<Users className="h-4 w-4" />}
                    title="Add a contact"
                    desc="Log a new lead in 10 seconds"
                  />
                  <NewDealDialog
                    contacts={contacts}
                    trigger={
                      <div className="flex cursor-pointer items-center gap-3 rounded-lg border bg-background p-3 transition-all hover:border-primary/40 hover:shadow-sm">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600">
                          <Briefcase className="h-4 w-4" />
                        </span>
                        <div className="flex-1 text-left">
                          <p className="text-sm font-medium">Open a deal</p>
                          <p className="text-xs text-muted-foreground">
                            Track a new opportunity
                          </p>
                        </div>
                        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    }
                  />
                  <QuickLink
                    href={saPath("/pipeline")}
                    icon={<GitBranch className="h-4 w-4" />}
                    title="Open pipeline"
                    desc="Move deals between stages"
                  />
                </div>
              </section>
            </div>
          </div>
      )}
    </div>
  );
}

function StatCard({
  href,
  icon,
  label,
  value,
  hint,
  tone,
  bg,
  loading,
}: {
  href?: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: string;
  bg: string;
  loading?: boolean;
}) {
  const content = (
    <>
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-lg ${bg} ${tone}`}
      >
        {icon}
      </span>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {loading ? (
        <div className="mt-1 h-8 w-24 animate-pulse rounded bg-muted" />
      ) : (
        <p className="mt-0.5 text-2xl font-semibold tracking-tight">{value}</p>
      )}
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </>
  );

  const baseClass =
    "block rounded-2xl border bg-card p-4 transition-all hover:border-primary/30 hover:shadow-sm";

  if (href) {
    return (
      <Link href={href} className={baseClass}>
        {content}
      </Link>
    );
  }
  return <div className={baseClass}>{content}</div>;
}

function QuickLink({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border bg-background p-3 transition-all hover:border-primary/40 hover:shadow-sm"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600">
        {icon}
      </span>
      <div className="flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
    </Link>
  );
}

function GettingStarted() {
  const { saPath } = useSubAccount();
  return (
    <div className="rounded-2xl border border-dashed bg-gradient-to-br from-indigo-500/5 via-violet-500/5 to-pink-500/5 p-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500 text-white">
        <Sparkles className="h-6 w-6" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight">
        Let&apos;s get your first lead in
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Add a single contact, or migrate your whole list from another CRM by
        uploading a CSV.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button render={<Link href={saPath("/contacts")} />}>
          <Users className="mr-1 h-4 w-4" />
          Add your first contact
        </Button>
        <Button
          variant="outline"
          render={<Link href={`${saPath("/contacts")}?import=1`} />}
        >
          <Upload className="mr-1 h-4 w-4" />
          Upload CSV
        </Button>
        <Button
          variant="ghost"
          size="sm"
          render={
            <a
              href="/contacts-template.csv"
              download="leadstack-contacts-template.csv"
            />
          }
        >
          <Download className="mr-1 h-3.5 w-3.5" />
          Download template
        </Button>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Template columns: <code>name, email, phone, company, source, tags</code>
      </p>
    </div>
  );
}
