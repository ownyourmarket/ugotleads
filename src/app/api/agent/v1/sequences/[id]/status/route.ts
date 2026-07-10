import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import { requireServiceAuth, subAccountAllowed } from "@/lib/auth/require-service-auth";
import type { AutomationDoc } from "@/types";

export const GET = withAgentRoute<{ params: Promise<{ id: string }> }>(
  async (request, ctx) => {
    const { id } = await ctx.params;

    const access = await requireServiceAuth(request, { scope: "reports:read" });
    if (access instanceof NextResponse) return access;

    const db = getAdminDb();
    const autoSnap = await db.doc(`automations/${id}`).get();
    if (!autoSnap.exists) return agentError("NOT_FOUND", "Sequence not found.", 404);
    const automation = autoSnap.data() as AutomationDoc;
    if (!subAccountAllowed(access, automation.subAccountId)) {
      return agentError("NOT_FOUND", "Sequence not found.", 404);
    }
    if (automation.recipeType !== "outbound_sequence") {
      return agentError("VALIDATION_FAILED", "Automation is not an outbound sequence.", 400);
    }

    const snap = await db
      .collection("automation_executions")
      .where("automationId", "==", id)
      .select("status", "stoppedReason")
      .limit(5000)
      .get();
    const counts: Record<string, number> = { running: 0, completed: 0, stopped: 0, failed: 0 };
    const stoppedReasons: Record<string, number> = {};
    for (const d of snap.docs) {
      const s = d.data();
      counts[(s.status as string) ?? "failed"] = (counts[(s.status as string) ?? "failed"] ?? 0) + 1;
      if (s.stoppedReason) {
        stoppedReasons[s.stoppedReason as string] = (stoppedReasons[s.stoppedReason as string] ?? 0) + 1;
      }
    }
    return NextResponse.json({
      data: {
        sequence: { id, name: automation.name, enabled: automation.enabled },
        counts,
        stoppedReasons,
      },
    });
  },
);
