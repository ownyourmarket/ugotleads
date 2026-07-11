"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bot, Send, User } from "lucide-react";
import { useSubAccount } from "@/context/sub-account-context";
import { subscribeToPeGpts } from "@/lib/firestore/promptexpert";
import type { PeGpt } from "@/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const MAX_MESSAGE_LENGTH = 4000;
const COUNTER_THRESHOLD = 3500;

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

function newMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Chat screen for a single saved PromptExpert GPT. Token-styled bubbles
 * mirror `web-chat-session-thread.tsx`'s structural pattern (avatar +
 * bordered content box) — this is a fresh implementation, not a reuse of
 * the embed widget's `chat-window.tsx` (which is inline-styled by design
 * for third-party embedding).
 *
 * Error strings for 402/403/429/network/generic are copied verbatim from
 * the Skills run panel (`promptexpert/skills/page.tsx`) per the shared
 * house convention for AI-run failures, with only the 402 message's "run"
 * -> "message" wording adapted (the API's numbers are used as-is).
 *
 * On error, the optimistic user bubble is kept in the thread and the error
 * renders as a destructive-toned block below it — we do not roll back the
 * user's message, since it's still meaningful history of what was asked
 * even though the assistant didn't reply.
 */
export default function GptChatPage() {
  const params = useParams<{ subAccountId: string; gptId: string }>();
  const gptId = params?.gptId ?? "";
  const { subAccountId, agencyId, saPath } = useSubAccount();

  const [gpts, setGpts] = useState<PeGpt[] | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTopUp, setShowTopUp] = useState(false);

  // Bumped whenever the target GPT changes so an in-flight response for a
  // previous conversation can never land in this one's thread/session.
  const generation = useRef(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const scope = useMemo(
    () => ({ agencyId: agencyId ?? "", subAccountId }),
    [agencyId, subAccountId],
  );

  useEffect(() => {
    if (!agencyId || !subAccountId) return;
    // Undeployed Firestore rules (or any other subscription failure) must
    // fail loudly — surface it and drop the "loading" skeleton instead of
    // leaving this screen stuck showing "Loading…" forever.
    return subscribeToPeGpts(scope, setGpts, (err) => {
      console.error("[promptexpert]", err);
      toast.error("Could not load GPTs — check your access or try again.");
      setGpts([]);
    });
  }, [scope, agencyId, subAccountId]);

  useEffect(() => {
    generation.current += 1;
    setMessages([]);
    setSessionId(null);
    setInput("");
    setError(null);
    setShowTopUp(false);
    setBusy(false);
  }, [gptId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const gpt = gpts?.find((g) => g.id === gptId) ?? null;

  async function sendMessage() {
    if (!gpt) return;
    const trimmed = input.trim();
    if (!trimmed || busy || trimmed.length > MAX_MESSAGE_LENGTH) return;
    const gen = generation.current;

    setMessages((m) => [...m, { id: newMessageId(), role: "user", content: trimmed }]);
    setInput("");
    setError(null);
    setShowTopUp(false);
    setBusy(true);

    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/promptexpert/gpts/${gpt.id}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, message: trimmed }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (gen !== generation.current) return;

      if (res.ok) {
        // "" (or any non-string) means server-side session bookkeeping
        // degraded for this turn — keep whatever sessionId we already have
        // rather than clearing it; the next turn simply starts fresh
        // server-side instead of losing a still-valid session id.
        if (typeof body.sessionId === "string" && body.sessionId) {
          setSessionId(body.sessionId);
        }
        setMessages((m) => [
          ...m,
          { id: newMessageId(), role: "assistant", content: body.reply ?? "" },
        ]);
      } else if (res.status === 402) {
        setError(
          `Not enough credits: you have ${body.currentBalance}, this message needs ${body.required}.`,
        );
        setShowTopUp(true);
      } else if (res.status === 403) {
        setError("PromptExpert is an add-on for BYOK plans — see the marketplace to unlock it.");
      } else if (res.status === 429) {
        setError("Monthly AI usage cap reached for this workspace.");
      } else {
        setError("Run failed — please try again.");
      }
    } catch {
      if (gen !== generation.current) return;
      setError("Network error — please try again.");
    } finally {
      if (gen === generation.current) setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  if (gpts === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!gpt) {
    return (
      <div className="space-y-5">
        <Link
          href={saPath("/promptexpert/gpts")}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to GPTs
        </Link>
        <div className="rounded-2xl border border-dashed bg-muted/10 p-10 text-center">
          <h2 className="text-base font-semibold">GPT not found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been deleted, or you may not have access to it.
          </p>
        </div>
      </div>
    );
  }

  const overLimit = input.length > MAX_MESSAGE_LENGTH;
  const canSend = !busy && input.trim().length > 0 && !overLimit;

  return (
    <div className="space-y-5">
      <Link
        href={saPath("/promptexpert/gpts")}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to GPTs
      </Link>

      <section className="rounded-2xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500 text-white">
            <Bot className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{gpt.name}</h1>
            {gpt.description && (
              <p className="mt-0.5 text-sm text-muted-foreground">{gpt.description}</p>
            )}
            <Badge variant="outline" className="mt-2">
              {gpt.creditCostPerMessage} credit/message · runs on your workspace credits
            </Badge>
          </div>
        </div>
      </section>

      <section
        aria-live="polite"
        className="flex max-h-[55vh] min-h-[240px] flex-col gap-3 overflow-y-auto rounded-2xl border bg-card p-5"
      >
        {messages.length === 0 ? (
          <p className="text-xs text-muted-foreground">Say hello to start the conversation.</p>
        ) : (
          messages.map((m) => <ChatBubble key={m.id} message={m} />)
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
            {showTopUp && (
              <div className="mt-2">
                <Button size="sm" variant="outline" render={<Link href={saPath("/credits")} />}>
                  Top up credits
                </Button>
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={busy}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={3}
          placeholder="Type a message… (Enter to send, Shift+Enter for a new line)"
          aria-label="Message"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {input.length > COUNTER_THRESHOLD ? `${input.length}/${MAX_MESSAGE_LENGTH}` : ""}
          </span>
          <Button onClick={() => void sendMessage()} disabled={!canSend}>
            <Send className="mr-1 h-3.5 w-3.5" />
            {busy ? "Sending…" : "Send"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isAssistant = message.role === "assistant";
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isAssistant
            ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {isAssistant ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
      </span>
      <div className="flex-1 rounded-xl border bg-background p-3">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {isAssistant ? "Assistant" : "You"}
        </div>
        <p className="whitespace-pre-wrap text-[13px]">{message.content}</p>
      </div>
    </div>
  );
}
