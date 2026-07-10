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
  // Runtime-defensive against non-string input (bodies come from untrusted JSON).
  const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  return {
    name: s(input.name),
    email: s(input.email).toLowerCase(),
    phone: s(input.phone),
    company: s(input.company),
    source: s(input.source) || "other",
    tags: (Array.isArray(input.tags) ? input.tags : [])
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim().slice(0, 50))
      .filter(Boolean),
    pipelineStage:
      typeof input.pipelineStage === "string" && input.pipelineStage
        ? input.pipelineStage
        : "new",
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
