import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { sendSmsForSubAccount } from "@/lib/comms/twilio";
import { callAi, type AiChatMessage } from "@/lib/comms/ai/openrouter";
import {
  incrementChannelTokens,
  type ConfiguredChannelId,
} from "@/lib/comms/ai/agent";
import { buildContactContextBlock } from "@/lib/comms/ai/context";
import { buildSystemPrompt } from "@/lib/comms/ai/prompt";
import {
  matchEscalationKeyword,
  sendEscalationNotification,
} from "@/lib/comms/ai/escalation";
import type { ResolvedAiAgent } from "@/types/ai";
import type { SubAccountDoc } from "@/types";
import type { Contact } from "@/types/contacts";

interface RespondInput {
  subAccountId: string;
  subAccount: SubAccountDoc;
  /** Profile + channel config, already merged into effective values by
   *  the webhook caller via resolveAgent(). */
  agent: ResolvedAiAgent;
  /** Which channel this respond run is for. Currently always "sms"; the
   *  param exists so voice/email future calls reuse the same orchestrator. */
  channelId: ConfiguredChannelId;
  contact: Contact;
  /** The just-arrived inbound SMS text. */
  incomingMessage: string;
  /** Caller's twilio "From" — needed for the outbound reply destination. */
  contactPhone: string;
}

type AiSkipReason =
  | "disabled"
  | "no_prompt"
  | "outside_hours"
  | "escalation_keyword"
  | "contact_opted_out"
  | "llm_failed";

type RespondOutcome =
  | { kind: "replied"; replyText: string; tokens: number }
  | { kind: "escalated"; keyword: string }
  | { kind: "skipped"; reason: AiSkipReason };

/**
 * Decides whether the current local time (in the configured timezone)
 * falls within the agent's active window. Supports overnight windows
 * (e.g. hoursStart=22, hoursEnd=6 = 10pm to 6am).
 */
function isWithinHours(
  hoursStart: number,
  hoursEnd: number,
  timezone: string,
): boolean {
  const now = new Date();
  let hour: number;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone || "UTC",
    }).formatToParts(now);
    const hourPart = parts.find((p) => p.type === "hour");
    hour = hourPart ? Number(hourPart.value) : now.getUTCHours();
    if (!Number.isFinite(hour)) hour = now.getUTCHours();
    if (hour === 24) hour = 0;
  } catch {
    hour = now.getUTCHours();
  }

  const start = Math.max(0, Math.min(23, Math.floor(hoursStart)));
  const end = Math.max(0, Math.min(23, Math.floor(hoursEnd)));
  if (start === end) return true; // 24/7
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

async function loadRecentHistory(
  contactId: string,
  limit: number,
  excludeBody: string,
): Promise<AiChatMessage[]> {
  const safeLimit = Math.max(1, Math.min(50, limit));
  const snap = await getAdminDb()
    .collection("contacts")
    .doc(contactId)
    .collection("messages")
    .orderBy("createdAt", "desc")
    .limit(safeLimit + 1)
    .get();
  const docs = snap.docs.reverse();
  const turns: AiChatMessage[] = [];
  for (const d of docs) {
    const data = d.data() as { direction?: string; body?: string };
    if (!data.body) continue;
    if (data.direction === "inbound" && data.body.trim() === excludeBody.trim()) {
      continue;
    }
    turns.push({
      role: data.direction === "outbound" ? "assistant" : "user",
      content: data.body,
    });
  }
  return turns;
}

// System prompt building moved to @/lib/comms/ai/prompt — shared with the
// web-chat orchestrator and the "Test this persona" dry-run endpoint so
// every channel sees the same string the SMS path produces.

async function logActivity({
  contactId,
  agencyId,
  subAccountId,
  type,
  content,
  meta,
}: {
  contactId: string;
  agencyId: string;
  subAccountId: string;
  type: "ai_reply_sent" | "ai_escalated" | "ai_skipped";
  content: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await getAdminDb()
      .collection("contacts")
      .doc(contactId)
      .collection("activities")
      .add({
        type,
        content,
        meta: meta ?? null,
        agencyId,
        subAccountId,
        createdBy: "ai_inbound",
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch (err) {
    console.warn("[ai/respond] activity write failed", err);
  }
}

async function storeOutboundReply({
  contactId,
  agencyId,
  subAccountId,
  body,
  from,
  to,
  twilioSid,
}: {
  contactId: string;
  agencyId: string;
  subAccountId: string;
  body: string;
  from: string;
  to: string;
  twilioSid: string;
}): Promise<void> {
  try {
    await getAdminDb()
      .collection("contacts")
      .doc(contactId)
      .collection("messages")
      .doc(twilioSid)
      .set(
        {
          agencyId,
          subAccountId,
          contactId,
          direction: "outbound",
          status: "sent",
          body,
          from,
          to,
          twilioMessageSid: twilioSid,
          sentByUid: "ai",
          aiGenerated: true,
          error: null,
          readAt: null,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  } catch (err) {
    console.warn("[ai/respond] outbound message write failed", err);
  }
}

/**
 * Main orchestrator. Webhook caller already resolved profile + channel
 * into a ResolvedAiAgent via resolveAgent() — this function just
 * orchestrates the guards → context → LLM → send → log flow.
 */
export async function maybeRespondWithAi(
  input: RespondInput,
): Promise<RespondOutcome> {
  const {
    subAccountId,
    subAccount,
    agent,
    channelId,
    contact,
    incomingMessage,
    contactPhone,
  } = input;
  const eff = agent.effective;

  // Guard: contact is opted out of SMS.
  if (contact.smsOptedOut) {
    await logActivity({
      contactId: contact.id,
      agencyId: subAccount.agencyId,
      subAccountId,
      type: "ai_skipped",
      content: "AI reply skipped — contact is SMS-opted-out.",
      meta: { reason: "contact_opted_out" },
    });
    return { kind: "skipped", reason: "contact_opted_out" };
  }

  // Guard: profile prompt blank — refuse to send anything.
  if (!eff.systemPrompt.trim()) {
    await logActivity({
      contactId: contact.id,
      agencyId: subAccount.agencyId,
      subAccountId,
      type: "ai_skipped",
      content: "AI reply skipped — agent persona prompt is empty.",
      meta: { reason: "no_prompt" },
    });
    return { kind: "skipped", reason: "no_prompt" };
  }

  // Guard: outside configured business hours.
  if (!isWithinHours(eff.hoursStart, eff.hoursEnd, eff.timezone)) {
    await logActivity({
      contactId: contact.id,
      agencyId: subAccount.agencyId,
      subAccountId,
      type: "ai_skipped",
      content: `AI reply skipped — outside business hours (${eff.hoursStart}:00–${eff.hoursEnd}:00 ${eff.timezone}).`,
      meta: { reason: "outside_hours" },
    });
    return { kind: "skipped", reason: "outside_hours" };
  }

  // Guard: escalation keyword in the inbound text.
  const triggered = matchEscalationKeyword(
    incomingMessage,
    eff.escalationKeywords,
  );
  if (triggered) {
    if (eff.escalationNotifyEmail) {
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://leadstack.dev";
      await sendEscalationNotification({
        to: eff.escalationNotifyEmail,
        businessName:
          eff.businessName.trim() || subAccount.name || "your business",
        contactName: contact.name || "(unnamed)",
        contactPhone,
        contactId: contact.id,
        subAccountId,
        triggeredKeyword: triggered,
        incomingMessage,
        appUrl,
      });
    }
    await logActivity({
      contactId: contact.id,
      agencyId: subAccount.agencyId,
      subAccountId,
      type: "ai_escalated",
      content: `AI escalated to human — keyword "${triggered}" matched in inbound message.`,
      meta: { reason: "escalation_keyword", keyword: triggered, channel: channelId },
    });
    return { kind: "escalated", keyword: triggered };
  }

  // Build LLM context and call the model.
  let completion;
  try {
    const [history, contextBlock] = await Promise.all([
      loadRecentHistory(contact.id, eff.contextMessageCount, incomingMessage),
      buildContactContextBlock(contact).catch((err) => {
        console.warn(
          `[ai/respond] context block build failed for ${contact.id}`,
          err,
        );
        return null;
      }),
    ]);
    const systemPrompt = buildSystemPrompt({
      agent,
      channelId,
      fallbackBusinessName: subAccount.name ?? "the business",
      contactContextBlock: contextBlock,
    });
    const messages: AiChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: incomingMessage },
    ];
    completion = await callAi({
      model: eff.modelOverride ?? undefined,
      messages,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[ai/respond] LLM call failed for sa=${subAccountId}: ${msg}`);
    await logActivity({
      contactId: contact.id,
      agencyId: subAccount.agencyId,
      subAccountId,
      type: "ai_skipped",
      content: `AI reply skipped — LLM call failed: ${msg.slice(0, 200)}`,
      meta: { reason: "llm_failed", error: msg.slice(0, 500) },
    });
    return { kind: "skipped", reason: "llm_failed" };
  }

  // Send the reply via Twilio.
  let send;
  try {
    send = await sendSmsForSubAccount({
      subAccountId,
      subAccount,
      to: contactPhone,
      body: completion.text,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[ai/respond] Twilio send failed for sa=${subAccountId}: ${msg}`);
    await logActivity({
      contactId: contact.id,
      agencyId: subAccount.agencyId,
      subAccountId,
      type: "ai_skipped",
      content: `AI reply generated but Twilio send failed: ${msg.slice(0, 200)}`,
      meta: { reason: "llm_failed", twilioError: msg.slice(0, 500) },
    });
    return { kind: "skipped", reason: "llm_failed" };
  }

  await storeOutboundReply({
    contactId: contact.id,
    agencyId: subAccount.agencyId,
    subAccountId,
    body: completion.text,
    from: send.from,
    to: contactPhone,
    twilioSid: send.sid,
  });

  await logActivity({
    contactId: contact.id,
    agencyId: subAccount.agencyId,
    subAccountId,
    type: "ai_reply_sent",
    content: `AI replied via SMS (${completion.totalTokens} tokens, ${completion.model}).`,
    meta: {
      channel: channelId,
      model: completion.model,
      tokens: completion.totalTokens,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      twilioSid: send.sid,
    },
  });

  void incrementChannelTokens(subAccountId, channelId, completion.totalTokens);

  return {
    kind: "replied",
    replyText: completion.text,
    tokens: completion.totalTokens,
  };
}
