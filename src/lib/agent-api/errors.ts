import { NextResponse } from "next/server";

export type AgentErrorCode =
  | "INVALID_KEY"
  | "SCOPE_MISSING"
  | "SUB_ACCOUNT_FORBIDDEN"
  | "CAP_EXCEEDED"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "CONTACT_OPTED_OUT"
  | "CONFIRM_MISMATCH"
  | "SEND_FAILED";

export function agentError(
  code: AgentErrorCode,
  message: string,
  status: number,
  details?: unknown,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status, ...(headers ? { headers } : {}) },
  );
}
