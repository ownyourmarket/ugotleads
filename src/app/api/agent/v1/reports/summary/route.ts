import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import { requireServiceAuth } from "@/lib/auth/require-service-auth";

const MAX_DOCS = 5000;

export const GET = withAgentRoute(async (request: Request) => {
  const url = new URL(request.url);
  const subAccountId = url.searchParams.get("subAccountId");
  if (!subAccountId) {
    return agentError("VALIDATION_FAILED", "subAccountId query param is required.", 400);
  }
  const access = await requireServiceAuth(request, {
    scope: "reports:read",
    subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const db = getAdminDb();
  const [contactsSnap, dealsSnap] = await Promise.all([
    db
      .collection("contacts")
      .where("subAccountId", "==", subAccountId)
      .select("pipelineStage", "emailOptedOut")
      .limit(MAX_DOCS)
      .get(),
    db
      .collection("deals")
      .where("subAccountId", "==", subAccountId)
      .select("stageId", "value")
      .limit(MAX_DOCS)
      .get(),
  ]);

  const byStage: Record<string, number> = {};
  let emailOptedOut = 0;
  for (const d of contactsSnap.docs) {
    const c = d.data();
    const stage = (c.pipelineStage as string) ?? "none";
    byStage[stage] = (byStage[stage] ?? 0) + 1;
    if (c.emailOptedOut === true) emailOptedOut++;
  }

  const dealsByStage: Record<string, number> = {};
  const valueByStage: Record<string, number> = {};
  for (const d of dealsSnap.docs) {
    const deal = d.data();
    const stage = (deal.stageId as string) ?? "none";
    dealsByStage[stage] = (dealsByStage[stage] ?? 0) + 1;
    const value = typeof deal.value === "number" && Number.isFinite(deal.value) ? deal.value : 0;
    valueByStage[stage] = (valueByStage[stage] ?? 0) + value;
  }

  return NextResponse.json({
    data: {
      contacts: { total: contactsSnap.size, byStage, emailOptedOut },
      deals: { total: dealsSnap.size, byStage: dealsByStage, valueByStage },
    },
  });
});
