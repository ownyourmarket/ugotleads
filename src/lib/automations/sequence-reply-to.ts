import "server-only";

import { buildReplyToken } from "./reply-token";
import type { RecipeType } from "@/types";

/**
 * Resolves the Reply-To address for a single outbound send.
 *
 * - Static recipients (owner-notify steps) never get a reply-to — routing
 *   a reply back to the sub-account inbox is pointless when the send
 *   already went to a person, not the lead.
 * - `outbound_sequence` sends to a contact, with an inbound domain
 *   configured, get an HMAC-signed reply token address
 *   (`reply+<contactId>.<hmac12>@<domain>`) so a reply can be matched back
 *   to the contact and used to stop the sequence. Raw contact IDs are not
 *   used — they're visible to every recipient and would let a third party
 *   stop a contact's sequence or inject spoofed replies by guessing/
 *   observing an ID (plan ruling from Task 9's review).
 * - Everything else (no inbound domain configured, non-sequence recipe
 *   types, or a token that couldn't be built because the secret is
 *   unset/misconfigured) falls back to the sub-account's plain
 *   `replyToEmail`, same as today.
 */
export function resolveSequenceReplyTo(input: {
  recipeType: RecipeType;
  recipientKind: "contact" | "static";
  contactId: string;
  subAccountReplyTo: string | null | undefined;
  inboundDomain: string | null | undefined; // process.env.INBOUND_REPLY_DOMAIN
}): string | undefined {
  if (input.recipientKind === "static") return undefined;

  if (input.recipeType === "outbound_sequence" && input.inboundDomain) {
    const token = buildReplyToken(input.contactId);
    if (token) return `reply+${token}@${input.inboundDomain}`;
    // Secret unset/misconfigured — degrade to the plain reply-to rather
    // than crash the send or emit an unverifiable address.
  }

  return input.subAccountReplyTo ?? undefined;
}
