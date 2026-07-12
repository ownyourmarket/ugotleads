"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, type LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useAgency } from "@/hooks/use-agency";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const MAX_MESSAGE_CHARS = 4000;
const MAX_CONTEXT_CHARS = 8000;

interface AgentRunResponse {
  agentLabel: string;
  model: string;
  text: string;
  usage: { totalTokens: number };
}

export interface AgentWorkbenchProps {
  /** Agent key accepted by POST /api/agency/agents. */
  agentKey: "marketing-copywriter" | "compliance-reviewer";
  /** Page heading, e.g. "Copywriter". */
  title: string;
  /** One-sentence description under the heading. */
  description: string;
  /** Header icon. */
  icon: LucideIcon;
  /** Tailwind classes for the header icon chip, e.g. "bg-violet-500/10 text-violet-600". */
  iconChipClassName: string;
  /** Label above the task field, e.g. "What do you need written?". */
  taskLabel: string;
  /** Placeholder for the task field. */
  taskPlaceholder: string;
  /** Placeholder for the optional context field. */
  contextPlaceholder: string;
  /** Example tasks shown as one-click chips when the task field is empty. */
  examples: string[];
}

/**
 * Shared workbench UI for the agency-owner SOUL agents (Copywriter,
 * Compliance). Task + optional context in, single completion out.
 * Stateless by design — nothing is persisted; the runner does not write
 * to Firestore.
 */
export function AgentWorkbench({
  agentKey,
  title,
  description,
  icon: Icon,
  iconChipClassName,
  taskLabel,
  taskPlaceholder,
  contextPlaceholder,
  examples,
}: AgentWorkbenchProps) {
  const { user, loading, agencyRole } = useAuth();
  const agency = useAgency();

  const [message, setMessage] = useState("");
  const [context, setContext] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AgentRunResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.title = `${title} · ${agency.name}`;
  }, [title, agency.name]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-2xl bg-muted/40" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
        Sign in to view this page.
      </div>
    );
  }

  if (agencyRole !== "owner") {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
        Only the agency owner can use the {title} agent.
      </div>
    );
  }

  const canRun = !running && message.trim().length > 0;

  async function run() {
    if (!canRun) return;
    setRunning(true);
    setError(null);

    try {
      const res = await fetch("/api/agency/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentKey,
          userMessage: message.trim(),
          context: context.trim() || undefined,
        }),
      });

      const data = (await res.json().catch(() => null)) as
        | (AgentRunResponse & { error?: string })
        | null;

      if (!res.ok || !data?.text) {
        setError(
          data?.error ?? "The agent could not complete this request. Try again.",
        );
        return;
      }

      setResult(data);
      // Bring the fresh result into view; respect reduced-motion.
      requestAnimationFrame(() => {
        resultRef.current?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "nearest",
        });
      });
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setRunning(false);
    }
  }

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
    } catch {
      setError("Could not copy to clipboard.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            iconChipClassName,
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </header>

      <section className="space-y-4 rounded-2xl border bg-card p-6">
        <div className="space-y-2">
          <Label htmlFor="agent-task">{taskLabel}</Label>
          <Textarea
            id="agent-task"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
            placeholder={taskPlaceholder}
            rows={4}
            disabled={running}
          />
          {message.trim().length === 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setMessage(example)}
                  className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {example}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="agent-context">
            Context{" "}
            <span className="font-normal text-muted-foreground">
              (optional — paste a draft, offer details, or page copy)
            </span>
          </Label>
          <Textarea
            id="agent-context"
            value={context}
            onChange={(e) => setContext(e.target.value.slice(0, MAX_CONTEXT_CHARS))}
            placeholder={contextPlaceholder}
            rows={3}
            disabled={running}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Runs on your deployment&apos;s AI model and uses AI credits.
          </p>
          <Button onClick={run} disabled={!canRun}>
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Working…
              </>
            ) : (
              "Generate"
            )}
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </section>

      <div aria-live="polite" ref={resultRef}>
        {result && (
          <section className="space-y-3 rounded-2xl border bg-card p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">{result.agentLabel}</h2>
              <Button variant="outline" size="sm" onClick={copyResult}>
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4" aria-hidden />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" aria-hidden />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">
              {result.text}
            </div>
            <p className="text-xs text-muted-foreground">
              {result.model} · {result.usage.totalTokens.toLocaleString()} tokens
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
