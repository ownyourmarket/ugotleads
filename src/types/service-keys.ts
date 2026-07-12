import type { Timestamp, FieldValue } from "firebase/firestore";

/** Permission scopes a service key may hold. Phase-2 scopes are reserved
 * here so the union doesn't churn when sequences/replies ship. */
export type ServiceScope =
  | "contacts:read"
  | "contacts:write"
  | "deals:write"
  | "templates:read"
  | "templates:write"
  | "sends:execute"
  | "reports:read"
  | "sequences:write"
  | "sequences:enroll"
  | "replies:read"
  | "replies:write"
  | "control_plane:read";

/** Top-level `agencyServiceKeys/{keyId}` document. The plaintext key is
 * shown once at mint time and never stored. */
export interface ServiceKeyDoc {
  id: string;
  agencyId: string;
  label: string;
  /** sha256 hex of the full plaintext key. */
  keyHash: string;
  /** First 8 chars of the plaintext key, for display/audit (e.g. "ugl_a1b2"). */
  keyPrefix: string;
  allowedSubAccounts: string[];
  scopes: ServiceScope[];
  status: "active" | "revoked";
  createdByUid: string;
  createdAt: Timestamp | FieldValue | null;
  lastUsedAt: Timestamp | FieldValue | null;
}
