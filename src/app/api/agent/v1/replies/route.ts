import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import { requireServiceAuth } from "@/lib/auth/require-service-auth";

export const GET = withAgentRoute(async (request: Request) => {
  const url = new URL(request.url);
  const subAccountId = url.searchParams.get("subAccountId");
  if (!subAccountId) {
    return agentError(
      "VALIDATION_FAILED",
      "subAccountId query param is required.",
      400
    );
  }

  const access = await requireServiceAuth(request, {
    scope: "replies:read",
    subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit")) || 20, 1),
    100
  );
  let q = getAdminDb()
    .collection("inbound_emails")
    .where("subAccountId", "==", subAccountId);

  const handled = url.searchParams.get("handled");
  if (handled === "false") {
    q = q.where("handled", "==", false);
  }

  const snap = await q.limit(limit).get();
  const data = snap.docs.map((d) => {
    const doc = d.data();
    return {
      id: d.id,
      contactId: doc.contactId,
      fromEmail: doc.fromEmail,
      subject: doc.subject,
      text: doc.text,
      handled: doc.handled,
      matchedBy: doc.matchedBy,
      receivedAt: doc.receivedAt,
    };
  });
  return NextResponse.json({ data });
});
