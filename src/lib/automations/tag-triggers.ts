import "server-only";

import { fireTriggers } from "./triggers";

/**
 * Fire tag_added triggers for every unique tag just added to a contact.
 * Server-side tag-write paths call this (bulk tag, merge, agent API);
 * client-SDK writes (dashboard form, CSV import) are covered by the
 * enroll endpoint's catch-up sync instead. Never throws — enrollment is
 * idempotent, so over-firing is harmless and under-firing is caught up.
 */
export async function fireTagAddedTriggers(input: {
  agencyId: string;
  subAccountId: string;
  contactId: string;
  addedTags: string[];
}): Promise<void> {
  const unique = [...new Set(input.addedTags.map((t) => t.trim()).filter(Boolean))];
  for (const tag of unique) {
    await fireTriggers({
      agencyId: input.agencyId,
      subAccountId: input.subAccountId,
      triggerType: "tag_added",
      contactId: input.contactId,
      context: { tag },
    });
  }
}
