import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import { requireServiceAuth } from "@/lib/auth/require-service-auth";
import { validateEmailBody } from "@/lib/automations/merge-tags";

export const GET = withAgentRoute(async (request: Request) => {
  const url = new URL(request.url);
  const subAccountId = url.searchParams.get("subAccountId");
  if (!subAccountId) {
    return agentError("VALIDATION_FAILED", "subAccountId query param is required.", 400);
  }
  const access = await requireServiceAuth(request, {
    scope: "templates:read",
    subAccountId,
  });
  if (access instanceof NextResponse) return access;

  let q = getAdminDb()
    .collection("message_templates")
    .where("subAccountId", "==", subAccountId);
  const type = url.searchParams.get("type");
  if (type) q = q.where("type", "==", type);

  const snap = await q.limit(100).get();
  const data = snap.docs.map((d) => {
    const t = d.data();
    return { id: d.id, type: t.type, name: t.name, subject: t.subject ?? null, body: t.body };
  });
  return NextResponse.json({ data });
});

export const POST = withAgentRoute(async (request: Request) => {
  const body = (await request.json().catch(() => null)) as {
    subAccountId?: string;
    type?: string;
    name?: string;
    subject?: string;
    body?: string;
  } | null;

  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const templateBody = typeof body?.body === "string" ? body.body.trim() : undefined;
  if (
    !body ||
    typeof body.subAccountId !== "string" ||
    (body.type !== "email" && body.type !== "sms") ||
    !name ||
    !templateBody
  ) {
    return agentError(
      "VALIDATION_FAILED",
      'subAccountId, type ("email"|"sms"), name, and body are required.',
      400,
    );
  }
  const subject = typeof body.subject === "string" ? body.subject.trim() : null;
  if (body.type === "email") {
    if (!subject) {
      return agentError("VALIDATION_FAILED", "subject is required for email templates.", 400);
    }
    const err = validateEmailBody(templateBody);
    if (err) return agentError("VALIDATION_FAILED", err, 400);
  }

  const access = await requireServiceAuth(request, {
    scope: "templates:write",
    subAccountId: body.subAccountId,
  });
  if (access instanceof NextResponse) return access;

  const ref = await getAdminDb().collection("message_templates").add({
    agencyId: access.agencyId,
    subAccountId: access.subAccountId,
    type: body.type,
    name,
    subject: body.type === "email" ? subject : null,
    body: templateBody,
    createdByUid: `agent:${access.keyPrefix}`,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return NextResponse.json({ data: { id: ref.id } }, { status: 201 });
});
