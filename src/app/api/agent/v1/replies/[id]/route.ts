import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import {
  requireServiceAuth,
  subAccountAllowed,
} from "@/lib/auth/require-service-auth";

async function loadAuthorizedReply(
  request: Request,
  id: string,
  scope: "replies:read" | "replies:write",
) {
  const access = await requireServiceAuth(request, { scope });
  if (access instanceof NextResponse) return access;

  const ref = getAdminDb().doc(`inbound_emails/${id}`);
  const snap = await ref.get();
  if (!snap.exists) return agentError("NOT_FOUND", "Reply not found.", 404);
  const reply = snap.data() as Record<string, unknown>;
  if (!subAccountAllowed(access, reply.subAccountId as string)) {
    // Doc-ID-resolved foreign tenant: 404, not 403 — don't reveal existence.
    return agentError("NOT_FOUND", "Reply not found.", 404);
  }
  return { access, ref, reply };
}

export const PATCH = withAgentRoute<{ params: Promise<{ id: string }> }>(async (
  request,
  ctx,
) => {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as {
    handled?: unknown;
  } | null;
  if (!body) return agentError("VALIDATION_FAILED", "Invalid JSON body.", 400);

  if (typeof body.handled !== "boolean") {
    return agentError("VALIDATION_FAILED", "handled must be a boolean.", 400);
  }

  const loaded = await loadAuthorizedReply(request, id, "replies:write");
  if (loaded instanceof NextResponse) return loaded;
  const { ref } = loaded;

  await ref.update({ handled: body.handled });
  return NextResponse.json({ data: { id, handled: body.handled } });
});
