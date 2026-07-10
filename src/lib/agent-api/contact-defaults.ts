import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { AgentAccess } from "@/lib/auth/require-service-auth";

export interface AgentContactInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  tags?: string[];
  source?: string;
  pipelineStage?: string;
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Full Contact document (see src/types/contacts.ts) with agent defaults.
 * subAccountId must already be resolved+authorized on `access`. */
export function buildContactDoc(
  access: AgentAccess,
  input: AgentContactInput,
): Record<string, unknown> {
  return {
    name: input.name?.trim() ?? "",
    email: input.email?.trim().toLowerCase() ?? "",
    phone: input.phone?.trim() ?? "",
    company: input.company?.trim() ?? "",
    source: input.source?.trim() || "other",
    tags: (input.tags ?? []).map((t) => t.trim().slice(0, 50)).filter(Boolean),
    pipelineStage: input.pipelineStage ?? "new",
    attribution: null,
    agencyId: access.agencyId,
    subAccountId: access.subAccountId,
    createdByUid: `agent:${access.keyPrefix}`,
    emailOptedOut: false,
    smsOptedOut: false,
    countryCode: null,
    country: null,
    city: null,
    lat: null,
    lng: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}
