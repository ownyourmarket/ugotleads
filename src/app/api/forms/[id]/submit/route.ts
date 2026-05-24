import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { fireTriggers } from "@/lib/automations/triggers";
import {
  EMPTY_LOCATION,
  ipFromRequest,
  locationFromIp,
  locationFromPhone,
  mergeLocation,
} from "@/lib/contacts/location";
import type { FormField, LeadForm } from "@/types/forms";
import type { ContactAttribution } from "@/types/contacts";

type SubmitBody = {
  values: Record<string, string>;
  attribution?: Partial<ContactAttribution>;
};

const ATTRIBUTION_KEYS: (keyof ContactAttribution)[] = [
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmContent",
  "utmTerm",
  "fbclid",
  "gclid",
  "landingPage",
  "referrer",
];

function normalizeAttribution(
  input: Partial<ContactAttribution> | undefined,
): ContactAttribution | null {
  if (!input || typeof input !== "object") return null;
  const out: ContactAttribution = {
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
    fbclid: null,
    gclid: null,
    landingPage: null,
    referrer: null,
  };
  let touched = false;
  for (const key of ATTRIBUTION_KEYS) {
    const raw = input[key];
    if (typeof raw === "string" && raw.trim().length > 0) {
      out[key] = raw.trim().slice(0, 500);
      touched = true;
    }
  }
  return touched ? out : null;
}

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => values[key] ?? "");
}

function contactFieldsFromSubmission(
  fields: FormField[],
  values: Record<string, string>,
): {
  name: string;
  email: string;
  phone: string;
  company: string;
  notes: string;
} {
  const out = { name: "", email: "", phone: "", company: "", notes: "" };
  for (const f of fields) {
    if (!f.mapsTo) continue;
    const v = (values[f.id] ?? "").toString().trim();
    if (!v) continue;
    out[f.mapsTo] = v;
  }
  return out;
}

/**
 * CORS headers for the public form submit endpoint. Wildcard origin is
 * intentional — the "Copy HTML snippet" feature lets the agency embed a
 * form into ANY third-party site (their client's marketing page, a
 * gitpage site, an external CMS). Same-domain submissions (the iframe
 * and the hosted /f/[id] page) work regardless.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function jsonWithCors(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...CORS_HEADERS },
  });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    return await handleSubmit(request, ctx);
  } catch (err) {
    // Last-resort guard so unhandled exceptions still come back with CORS
    // headers — otherwise the browser blocks the response and the script
    // sees a misleading "CORS" error instead of the real server error.
    console.error("[forms/submit] unhandled error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return jsonWithCors({ error: message }, { status: 500 });
  }
}

async function handleSubmit(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return jsonWithCors({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body.values !== "object") {
    return jsonWithCors({ error: "Missing values" }, { status: 400 });
  }

  const db = getAdminDb();
  const formRef = db.collection("forms").doc(id);
  const formSnap = await formRef.get();
  if (!formSnap.exists) {
    return jsonWithCors({ error: "Form not found" }, { status: 404 });
  }
  const form = { id: formSnap.id, ...(formSnap.data() as Omit<LeadForm, "id">) };
  if (!form.enabled) {
    return jsonWithCors({ error: "Form is paused" }, { status: 410 });
  }

  // Tenancy: every record this submission spawns inherits the form's
  // sub-account/agency. The form was already created inside one specific
  // sub-account; submissions must land in the same workspace.
  const agencyId = form.agencyId;
  const subAccountId = form.subAccountId;
  if (!agencyId || !subAccountId) {
    return jsonWithCors(
      { error: "Form is missing tenancy metadata" },
      { status: 500 },
    );
  }

  // Validate required fields
  for (const field of form.fields) {
    if (field.required) {
      const v = body.values[field.id];
      if (!v || !v.toString().trim()) {
        return jsonWithCors(
          { error: `Missing required field: ${field.label}` },
          { status: 400 },
        );
      }
    }
  }

  const mapped = contactFieldsFromSubmission(form.fields, body.values);
  const attribution = normalizeAttribution(body.attribution);

  // Build the combined placeholder bag for templates.
  const bag: Record<string, string> = { ...mapped };
  for (const f of form.fields) {
    bag[f.id] = body.values[f.id] ?? "";
  }

  // Audit: who created the records the public submission spawns. The form
  // creator is the closest available proxy when there's no authed caller.
  const submissionCreatedBy = form.createdByUid || "form-submission";

  // Best-effort location capture. IP geo is more precise (city + lat/lng);
  // phone country-code parsing is the fallback. Both fail soft — if neither
  // resolves, the contact still saves with null location fields and the
  // dashboard map just doesn't pin them.
  const ip = ipFromRequest(request);
  const [ipLoc, phoneLoc] = await Promise.all([
    ip ? locationFromIp(ip) : Promise.resolve(EMPTY_LOCATION),
    Promise.resolve(locationFromPhone(mapped.phone)),
  ]);
  const location = mergeLocation(ipLoc, phoneLoc);

  // Create the contact. `source` falls back to utm_source when the visitor
  // arrived via a tagged ad — otherwise the legacy "website" default.
  const contactRef = await db.collection("contacts").add({
    name: mapped.name,
    email: mapped.email,
    phone: mapped.phone,
    company: mapped.company,
    // Default to the explicit "website-form" source so the badge can
    // distinguish public form submissions from web-chat captures and
    // manually-created website contacts. UTM source still wins when
    // present so paid-traffic attribution flows through unchanged.
    source: attribution?.utmSource || "website-form",
    tags: form.settings.autoTags ?? [],
    pipelineStage: form.settings.pipelineStageId ?? null,
    attribution,
    agencyId,
    subAccountId,
    createdByUid: submissionCreatedBy,
    emailOptedOut: false,
    smsOptedOut: false,
    countryCode: location.countryCode,
    country: location.country,
    city: location.city,
    lat: location.lat,
    lng: location.lng,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Initial note from "notes"-mapped field (if present).
  if (mapped.notes) {
    await db
      .collection("contacts")
      .doc(contactRef.id)
      .collection("notes")
      .add({
        content: mapped.notes,
        createdBy: submissionCreatedBy,
        createdAt: FieldValue.serverTimestamp(),
      });
  }

  // Optional: open a deal in the configured pipeline stage.
  let dealId: string | null = null;
  if (form.settings.createDeal) {
    const stageId = form.settings.pipelineStageId ?? "new";
    const title =
      interpolate(form.settings.dealTitleTemplate || "New lead", bag) ||
      "New lead";
    const dealRef = await db.collection("deals").add({
      title,
      value: form.settings.dealValue || 0,
      currency: form.settings.dealCurrency || "USD",
      contactId: contactRef.id,
      stageId,
      priority: "medium",
      agencyId,
      subAccountId,
      createdByUid: submissionCreatedBy,
      lostReason: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      stageChangedAt: FieldValue.serverTimestamp(),
    });
    dealId = dealRef.id;
  }

  // Store submission record (admin-side only; rules deny client writes).
  await formRef.collection("submissions").add({
    formId: id,
    values: body.values,
    contactId: contactRef.id,
    dealId,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Bump form submission counter.
  await formRef.update({
    submissionCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Activity on the new contact. dealId is `string | null` — pass it through
  // as-is (null is a valid Firestore value; undefined is not).
  await db
    .collection("contacts")
    .doc(contactRef.id)
    .collection("activities")
    .add({
      type: "form_submitted",
      content: `Submitted form "${form.name}"`,
      createdBy: submissionCreatedBy,
      meta: { formId: id, dealId },
      createdAt: FieldValue.serverTimestamp(),
    });

  // Fire any matching automations. Failures are logged but don't break the
  // form submission response — the contact is already saved.
  await fireTriggers({
    agencyId,
    subAccountId,
    triggerType: "form_submit",
    contactId: contactRef.id,
    context: { formId: id },
  });

  return jsonWithCors({
    ok: true,
    contactId: contactRef.id,
    dealId,
    thankYouMessage: form.settings.thankYouMessage,
    redirectUrl: form.settings.redirectUrl || null,
  });
}
