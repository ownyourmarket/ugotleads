import "server-only";

/**
 * ⚠️ VOICE-PORT STUB — NOT THE REAL IMPLEMENTATION.
 *
 * WHAT THIS STUBS:
 *   `createCaptureFollowUp()` — in upstream this creates the post-capture
 *   follow-up Task ("Call back …") and sends the escalation email when a
 *   voice call produces a callback request / interested lead.
 *
 * WHO OWNS THE REAL IMPLEMENTATION:
 *   Upstream's refactored AI capture/follow-up layer
 *   (`src/lib/comms/ai/follow-up.ts`, 297 lines, 5 internal deps). On THIS
 *   repo the equivalent currently lives under
 *   `src/lib/comms/web-chat/follow-up.ts` (`createFollowUpActions`) — a
 *   web-chat-shaped signature, not the channel-generic one voice expects.
 *
 * HOW TO SWAP THE STUB FOR THE REAL THING LATER:
 *   Either (a) port upstream's `lib/comms/ai/follow-up.ts` + its 5 deps and
 *   delete this file, OR (b) adapt this stub to call the existing
 *   `lib/comms/web-chat/follow-up.ts` if its Task/email creation can be
 *   driven with `channelId:"voice"` inputs.
 *
 * FEATURE DELTA WHILE STUBBED:
 *   A voice call where the caller asks for a callback will NOT create a
 *   follow-up Task and will NOT send an escalation email. `end-of-call.ts`
 *   reads taskId=null / emailSent=false and proceeds. NOTE: the OUTBOUND
 *   campaign path in end-of-call.ts writes its own Task directly to the
 *   `tasks` collection (independent of this module), so campaign follow-ups
 *   still land — only the INBOUND callback Task + email are suppressed.
 */

export interface CreateCaptureFollowUpInput {
  agencyId: string;
  subAccountId: string;
  channelId: string;
  channelLabel: string;
  taskAction: string;
  sessionNoun: string;
  sessionId: string;
  sessionDeepLinkPath: string | null;
  contactId: string;
  capturedName: string | null;
  capturedEmail: string | null;
  capturedPhone: string | null;
  lastInboundMessage: string | null;
  pageUrl: string | null;
  [k: string]: unknown;
}

export interface CaptureFollowUpResult {
  taskId: string | null;
  emailSent: boolean;
  errors: string[];
}

export async function createCaptureFollowUp(
  input: CreateCaptureFollowUpInput,
): Promise<CaptureFollowUpResult> {
  console.info(
    `[voice-stub] follow-up stubbed — no Task/email created ` +
      `(sa=${input.subAccountId}, channel=${input.channelId}, contact=${input.contactId})`,
  );
  return { taskId: null, emailSent: false, errors: [] };
}
