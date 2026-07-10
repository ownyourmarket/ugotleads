import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import { requireServiceAuth } from "@/lib/auth/require-service-auth";

const MAX_STEPS = 10;

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
    scope: "sequences:write",
    subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const snap = await getAdminDb()
    .collection("automations")
    .where("subAccountId", "==", subAccountId)
    .where("recipeType", "==", "outbound_sequence")
    .limit(100)
    .get();
  const data = snap.docs.map((d) => {
    const a = d.data();
    return {
      id: d.id,
      name: a.name,
      enabled: a.enabled,
      trigger: a.trigger,
      stepCount: ((a.config as { steps?: unknown[] })?.steps ?? []).length,
    };
  });
  return NextResponse.json({ data });
});

export const POST = withAgentRoute(async (request: Request) => {
  const body = (await request.json().catch(() => null)) as {
    subAccountId?: string;
    name?: string;
    tag?: string;
    enabled?: boolean;
    steps?: { templateId?: string; delaySeconds?: number }[];
  } | null;

  const name =
    typeof body?.name === "string" ? body.name.trim().slice(0, 200) : "";
  if (
    !body ||
    typeof body.subAccountId !== "string" ||
    !body.subAccountId ||
    !name
  ) {
    return agentError(
      "VALIDATION_FAILED",
      "subAccountId and name are required.",
      400
    );
  }
  if (
    !Array.isArray(body.steps) ||
    body.steps.length === 0 ||
    body.steps.length > MAX_STEPS
  ) {
    return agentError(
      "VALIDATION_FAILED",
      `steps[] must contain 1-${MAX_STEPS} entries.`,
      400
    );
  }
  for (const s of body.steps) {
    if (
      !s ||
      typeof s.templateId !== "string" ||
      !s.templateId ||
      typeof s.delaySeconds !== "number" ||
      !Number.isFinite(s.delaySeconds) ||
      s.delaySeconds < 0
    ) {
      return agentError(
        "VALIDATION_FAILED",
        "Each step needs templateId and delaySeconds >= 0.",
        400
      );
    }
  }
  const tag = typeof body.tag === "string" ? body.tag.trim().slice(0, 50) : "";

  const access = await requireServiceAuth(request, {
    scope: "sequences:write",
    subAccountId: body.subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const db = getAdminDb();
  // Validate every template: exists, same sub-account, email type.
  for (const s of body.steps) {
    const t = await db.doc(`message_templates/${s.templateId}`).get();
    const td = t.data();
    if (!t.exists || td?.subAccountId !== access.subAccountId) {
      return agentError(
        "VALIDATION_FAILED",
        `Template ${s.templateId} not found in this sub-account.`,
        400
      );
    }
    if (td?.type !== "email") {
      return agentError(
        "VALIDATION_FAILED",
        `Template ${s.templateId} is not an email template (sequences are email-only in v1).`,
        400
      );
    }
  }

  const ref = db.collection("automations").doc();
  await ref.set({
    id: ref.id,
    agencyId: access.agencyId,
    subAccountId: access.subAccountId,
    recipeType: "outbound_sequence",
    name,
    enabled: body.enabled !== false,
    trigger: tag
      ? { type: "tag_added", formId: null, tag }
      : { type: "manual", formId: null, tag: null },
    config: {
      steps: body.steps.map((s) => ({
        channel: "email",
        templateId: s.templateId as string,
        delaySeconds: Math.floor(s.delaySeconds as number),
      })),
    },
    createdByUid: `agent:${access.keyPrefix}`,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return NextResponse.json({ data: { id: ref.id } }, { status: 201 });
});
