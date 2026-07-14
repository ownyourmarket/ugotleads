import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import { gitpageIsConfigured } from "@/lib/gitpage/client";
import { funnelFormFields, funnelFormSettings } from "@/types/forms";
import type { WebsiteConfig } from "@/types/website";
import { POST as submitWebsiteBuild } from "../website/build/route";

/**
 * One-click funnel: creates a lead-capture form wired into the CRM, then
 * submits a gitpage build whose CTA points at the form's hosted page
 * (/f/[formId]). Submissions flow through the existing public submit route —
 * contact + attribution + optional deal + automation triggers all fire with
 * zero extra wiring.
 *
 * Build normalization / validation / persistence is delegated to the
 * existing website build route so there is exactly one source of truth for
 * how a config reaches gitpage. If the build is rejected, the form is
 * deleted — a failed funnel leaves nothing behind.
 */

// Mirrors the (unexported) slugify in lib/firestore/forms.ts — that module
// imports the client SDK and can't be pulled into a server route.
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "form"
  );
}

const URL_RE = /^https?:\/\/.+/i;

interface FunnelFormOverrides {
  thankYouMessage?: string;
  /** Post-submit redirect, e.g. a thank-you page. http(s) URL. */
  redirectUrl?: string;
  createDeal?: boolean;
  dealValue?: number;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: subAccountId } = await ctx.params;
  const access = await requireSubAccountAdmin(request, subAccountId);
  if (access instanceof NextResponse) return access;

  if (!gitpageIsConfigured()) {
    return NextResponse.json(
      {
        error:
          "gitpage is not configured on this deployment (GITPAGE_API_KEY missing).",
      },
      { status: 503 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!appUrl) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_APP_URL is not set — cannot build the form URL." },
      { status: 503 },
    );
  }

  let body: {
    name?: unknown;
    config?: WebsiteConfig;
    form?: FunnelFormOverrides;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) {
    return NextResponse.json(
      { error: "`name` is required (1–80 characters)." },
      { status: 400 },
    );
  }

  const config = body.config;
  if (!config || typeof config !== "object") {
    return NextResponse.json(
      { error: "Body must include `config` object." },
      { status: 400 },
    );
  }

  const settings = funnelFormSettings();
  const overrides = body.form;
  if (overrides && typeof overrides === "object") {
    if (typeof overrides.thankYouMessage === "string") {
      settings.thankYouMessage = overrides.thankYouMessage.trim();
    }
    if (typeof overrides.redirectUrl === "string" && overrides.redirectUrl) {
      if (!URL_RE.test(overrides.redirectUrl.trim())) {
        return NextResponse.json(
          { error: "form.redirectUrl must start with http:// or https://." },
          { status: 400 },
        );
      }
      settings.redirectUrl = overrides.redirectUrl.trim();
    }
    if (typeof overrides.createDeal === "boolean") {
      settings.createDeal = overrides.createDeal;
    }
    if (
      typeof overrides.dealValue === "number" &&
      Number.isFinite(overrides.dealValue) &&
      overrides.dealValue >= 0
    ) {
      settings.dealValue = overrides.dealValue;
    }
  }

  const db = getAdminDb();
  const formRef = await db.collection("forms").add({
    name,
    slug: slugify(name),
    fields: funnelFormFields(),
    settings,
    agencyId: access.agencyId,
    subAccountId,
    createdByUid: access.uid,
    enabled: true,
    submissionCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const formUrl = `${appUrl}/f/${formRef.id}`;

  // The whole point of the funnel: the site's CTA is the hosted form.
  config.cta_link = formUrl;

  const buildRes = await submitWebsiteBuild(
    new Request(
      new URL(`/api/sub-accounts/${subAccountId}/website/build`, appUrl),
      {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify({ config }),
      },
    ),
    { params: Promise.resolve({ id: subAccountId }) },
  );

  let buildBody: Record<string, unknown> = {};
  try {
    buildBody = (await buildRes.json()) as Record<string, unknown>;
  } catch {
    // build route always returns JSON; defensive fallthrough only.
  }

  if (!buildRes.ok) {
    await formRef.delete();
    return NextResponse.json(buildBody, { status: buildRes.status });
  }

  return NextResponse.json({
    ...buildBody,
    formId: formRef.id,
    formUrl,
  });
}
