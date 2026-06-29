import "server-only";

/**
 * ⚠️ VOICE-PORT STUB — NOT THE REAL IMPLEMENTATION.
 *
 * WHAT THIS STUBS:
 *   `reconcileContactFromCapture()` — in upstream (leadstack-agency) this
 *   matches/creates a Contact from details captured during a voice call
 *   (phone-first or email-first reconciliation) and links it to the session.
 *
 * WHO OWNS THE REAL IMPLEMENTATION:
 *   Upstream's refactored AI capture/follow-up layer
 *   (`src/lib/comms/ai/capture.ts`, 242 lines, 3 internal deps). On THIS repo
 *   the equivalent logic currently lives under `src/lib/comms/web-chat/capture.ts`
 *   (`reconcileContactFromCapture` for web chat) — signatures differ.
 *
 * HOW TO SWAP THE STUB FOR THE REAL THING LATER:
 *   Either (a) port upstream's `lib/comms/ai/capture.ts` + its 3 deps and
 *   delete this file, OR (b) adapt this stub to delegate to the existing
 *   `lib/comms/web-chat/capture.ts::reconcileContactFromCapture` if the input
 *   shapes can be mapped (source "voice", phone-first matching).
 *
 * FEATURE DELTA WHILE STUBBED:
 *   A completed voice call will NOT create or link a Contact from captured
 *   caller details. `end-of-call.ts` treats a null return as "nothing to
 *   reconcile" and falls back to `payload.metaContactId` (outbound calls only).
 *   Net effect: INBOUND voice calls that capture a new lead's phone/email will
 *   summary-doc the call but will not auto-create a CRM Contact until ported.
 */

export interface ReconcileCaptureInput {
  agencyId: string;
  subAccountId: string;
  existingContactId: string | null;
  pageUrl: string | null;
  source: string;
  matchStrategy: string;
  capture: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  [k: string]: unknown;
}

export interface ReconcileResult {
  contactId: string;
  created: boolean;
}

export async function reconcileContactFromCapture(
  input: ReconcileCaptureInput,
): Promise<ReconcileResult | null> {
  console.info(
    `[voice-stub] capture reconcile stubbed — no Contact created/linked ` +
      `(sa=${input.subAccountId}, source=${input.source})`,
  );
  return null;
}
