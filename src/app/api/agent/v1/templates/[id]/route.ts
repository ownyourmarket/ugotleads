import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import {
  requireServiceAuth,
  subAccountAllowed,
} from "@/lib/auth/require-service-auth";
import { validateEmailBody } from "@/lib/automations/merge-tags";

const MAX_NAME_LEN = 200;
const MAX_SUBJECT_LEN = 300;
const MAX_BODY_LEN = 100_000;

async function loadAuthorizedTemplate(
  request: Request,
  id: string,
  scope: "templates:read" | "templates:write"
) {
  const access = await requireServiceAuth(request, { scope });
  if (access instanceof NextResponse) return access;
  const ref = getAdminDb().doc(`message_templates/${id}`);
  const snap = await ref.get();
  if (!snap.exists) return agentError("NOT_FOUND", "Template not found.", 404);
  const template = snap.data() as Record<string, unknown>;
  if (!subAccountAllowed(access, template.subAccountId as string)) {
    // Doc-ID-resolved foreign tenant: 404, not 403 — don't reveal existence.
    return agentError("NOT_FOUND", "Template not found.", 404);
  }
  return { access, ref, template };
}

export const GET = withAgentRoute<{ params: Promise<{ id: string }> }>(
  async (request, ctx) => {
    const { id } = await ctx.params;
    const loaded = await loadAuthorizedTemplate(request, id, "templates:read");
    if (loaded instanceof NextResponse) return loaded;
    const { template } = loaded;
    return NextResponse.json({
      data: {
        id,
        type: template.type,
        name: template.name,
        subject: template.subject ?? null,
        body: template.body,
      },
    });
  }
);

export const PATCH = withAgentRoute<{ params: Promise<{ id: string }> }>(
  async (request, ctx) => {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as {
      name?: string;
      subject?: string;
      body?: string;
    } | null;
    if (!body)
      return agentError("VALIDATION_FAILED", "Invalid JSON body.", 400);
    if (typeof body.name === "string" && body.name.length > MAX_NAME_LEN) {
      return agentError(
        "VALIDATION_FAILED",
        `name must be ${MAX_NAME_LEN} characters or fewer.`,
        400
      );
    }
    if (
      typeof body.subject === "string" &&
      body.subject.length > MAX_SUBJECT_LEN
    ) {
      return agentError(
        "VALIDATION_FAILED",
        `subject must be ${MAX_SUBJECT_LEN} characters or fewer.`,
        400
      );
    }
    if (typeof body.body === "string" && body.body.length > MAX_BODY_LEN) {
      return agentError(
        "VALIDATION_FAILED",
        `body must be ${MAX_BODY_LEN} characters or fewer.`,
        400
      );
    }

    const loaded = await loadAuthorizedTemplate(request, id, "templates:write");
    if (loaded instanceof NextResponse) return loaded;
    const { ref, template } = loaded;

    const nextBody =
      typeof body.body === "string"
        ? body.body.trim()
        : (template.body as string);
    if (template.type === "email") {
      const err = validateEmailBody(nextBody);
      if (err) return agentError("VALIDATION_FAILED", err, 400);
    }

    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (typeof body.name === "string" && body.name.trim())
      update.name = body.name.trim();
    if (typeof body.subject === "string" && template.type === "email") {
      const subject = body.subject.trim();
      if (!subject) {
        return agentError(
          "VALIDATION_FAILED",
          "subject cannot be blank on an email template.",
          400
        );
      }
      update.subject = subject;
    }
    if (typeof body.body === "string") update.body = nextBody;

    await ref.update(update);
    return NextResponse.json({ data: { id } });
  }
);
