import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import { requireServiceAuth, subAccountAllowed } from "@/lib/auth/require-service-auth";
import type { AutomationDoc } from "@/types";

const MAX_BATCH = 200;

export const POST = withAgentRoute<{ params: Promise<{ id: string }> }>(
  async (request, ctx) => {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as {
      contactIds?: string[];
    } | null;
    if (
      !body ||
      !Array.isArray(body.contactIds) ||
      body.contactIds.length === 0 ||
      body.contactIds.length > MAX_BATCH ||
      body.contactIds.some((c) => typeof c !== "string" || !c)
    ) {
      return agentError("VALIDATION_FAILED", `contactIds must contain 1-${MAX_BATCH} non-empty strings.`, 400);
    }

    const access = await requireServiceAuth(request, { scope: "sequences:enroll" });
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

    let stopped = 0;
    let notRunning = 0;
    for (const contactId of body.contactIds) {
      const ref = db.doc(`automation_executions/${id}_${contactId}`);
      const snap = await ref.get();
      if (!snap.exists || snap.data()?.status !== "running") {
        notRunning++;
        continue;
      }
      await ref.update({
        status: "stopped",
        stoppedReason: "manual",
        completedAt: FieldValue.serverTimestamp(),
      });
      stopped++;
    }
    return NextResponse.json({ data: { stopped, notRunning } });
  },
);
