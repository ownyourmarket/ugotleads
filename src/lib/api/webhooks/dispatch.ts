import "server-only";

/**
 * ⚠️ VOICE-PORT STUB — NOT THE REAL IMPLEMENTATION.
 *
 * WHAT THIS STUBS:
 *   `emitWebhookEvent()` — in upstream this enqueues + dispatches outbound
 *   webhook deliveries to a sub-account's registered `webhookSubscriptions`
 *   (creating `webhookEvents` / `deliveries` docs).
 *
 * WHO OWNS THE REAL IMPLEMENTATION:
 *   Upstream's WEBHOOKS feature (`src/lib/api/webhooks/dispatch.ts`, 136
 *   lines, 4 internal deps) plus the `webhookEvents`, `webhookSubscriptions`,
 *   and `deliveries` Firestore collections + rules. NONE of that exists on
 *   this repo yet — webhooks was scoped OUT of the voice port.
 *
 * HOW TO SWAP THE STUB FOR THE REAL THING LATER:
 *   Port the upstream webhooks feature (dispatch + its 4 deps + the 3
 *   collections + rules + the subscription management routes), then delete
 *   this file.
 *
 * FEATURE DELTA WHILE STUBBED:
 *   `voice.call.completed` and `voice.call.captured` webhook events are
 *   SUPPRESSED — any external system a sub-account wanted to notify on call
 *   completion receives nothing. Voice itself is unaffected (these calls are
 *   fire-and-forget `void` in end-of-call.ts). No data is lost in the CRM;
 *   only the outbound notification is dropped.
 */

export interface EmitWebhookEventInput {
  subAccountId: string;
  agencyId: string;
  mode: string;
  type: string;
  payload: Record<string, unknown>;
  [k: string]: unknown;
}

export async function emitWebhookEvent(
  input: EmitWebhookEventInput,
): Promise<void> {
  console.info(
    `[voice-stub] webhook dispatch stubbed — event suppressed ` +
      `(sa=${input.subAccountId}, type=${input.type})`,
  );
  return;
}
