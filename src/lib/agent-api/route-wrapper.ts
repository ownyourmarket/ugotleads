import "server-only";

import type { NextResponse } from "next/server";
import { agentError } from "@/lib/agent-api/errors";

/**
 * Guarantees the agent error envelope on unexpected failures. Every
 * /api/agent/v1 route handler should be wrapped: expected failures return
 * agentError(...) themselves; anything thrown lands here.
 */
export function withAgentRoute<Ctx = unknown>(
  handler: (request: Request, ctx: Ctx) => Promise<NextResponse>,
): (request: Request, ctx?: Ctx) => Promise<NextResponse> {
  // ctx is optional here (rather than mirroring the handler's required Ctx)
  // so routes with no dynamic segments — where Ctx defaults to `unknown` —
  // keep working with existing single-argument callers, in tests and in
  // Next.js's own invocation of static routes.
  return async (request, ctx) => {
    try {
      return await handler(request, ctx as Ctx);
    } catch (err) {
      console.error("[agent-api] unhandled route error", request.url, err);
      return agentError("INTERNAL_ERROR", "Unexpected server error.", 500);
    }
  };
}
