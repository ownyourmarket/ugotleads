import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { hashServiceKey } from "@/lib/agent-api/keys";
import type { ServiceKeyDoc, ServiceScope } from "@/types/service-keys";

export interface AgentAccess {
  keyId: string;
  keyPrefix: string;
  agencyId: string;
  scopes: ServiceScope[];
  allowedSubAccounts: string[];
  subAccountId: string | null;
}

/**
 * Auth guard for /api/agent/v1/* routes. Mirrors the shape of
 * require-tenancy.ts guards: returns AgentAccess on success, or a
 * ready-to-return NextResponse on failure.
 *
 * When the route knows its sub-account up front, pass opts.subAccountId
 * and the allowlist check happens here. Routes that resolve the
 * sub-account from a loaded doc (contact/deal/template) pass no
 * subAccountId and MUST call subAccountAllowed() themselves after
 * loading the doc.
 */
export async function requireServiceAuth(
  request: Request,
  opts: { scope: ServiceScope; subAccountId?: string },
): Promise<AgentAccess | NextResponse> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (ugl_[a-f0-9]{40})$/.exec(header);
  if (!match) {
    return agentError("INVALID_KEY", "Missing or malformed service key.", 401);
  }

  const db = getAdminDb();
  const snap = await db
    .collection("agencyServiceKeys")
    .where("keyHash", "==", hashServiceKey(match[1]))
    .limit(1)
    .get();
  if (snap.empty) {
    return agentError("INVALID_KEY", "Unknown service key.", 401);
  }

  const doc = snap.docs[0];
  const key = doc.data() as Omit<ServiceKeyDoc, "id">;
  if (key.status !== "active") {
    return agentError("INVALID_KEY", "Service key has been revoked.", 401);
  }
  if (!key.scopes.includes(opts.scope)) {
    return agentError("SCOPE_MISSING", `Key lacks required scope "${opts.scope}".`, 403);
  }
  if (opts.subAccountId !== undefined && !key.allowedSubAccounts.includes(opts.subAccountId)) {
    return agentError("SUB_ACCOUNT_FORBIDDEN", "Key cannot access this sub-account.", 403);
  }

  // Audit trail; failure here must never fail the request.
  void doc.ref
    .update({ lastUsedAt: FieldValue.serverTimestamp() })
    .catch(() => {});

  return {
    keyId: doc.id,
    keyPrefix: key.keyPrefix,
    agencyId: key.agencyId,
    scopes: key.scopes,
    allowedSubAccounts: key.allowedSubAccounts,
    subAccountId: opts.subAccountId !== undefined ? opts.subAccountId : null,
  };
}

export function subAccountAllowed(access: AgentAccess, subAccountId: string): boolean {
  return access.allowedSubAccounts.includes(subAccountId);
}
