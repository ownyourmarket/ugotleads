import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { linkSessionToContact } from "@/lib/comms/web-chat/session";

/**
 * Identity-capture pipeline for web-chat. The LLM emits a marker line at
 * the end of its reply when the visitor shares contact details:
 *
 *   [[capture name="Jane Doe" email="jane@x.com" phone="+61400000000"]]
 *
 * Server flow:
 *   1. Parse the marker out of the raw LLM text.
 *   2. Strip the marker so the visitor never sees it.
 *   3. Reconcile against existing Contacts (email match wins inside the
 *      sub-account) or create a fresh one tagged source="web-chat".
 *   4. Link the session's contactId so subsequent turns get the contact
 *      context block injected.
 *
 * One-shot: once a session is linked, the marker is ignored on later
 * replies even if the LLM repeats it.
 */

const MARKER_RE =
  /\[\[capture\s+([^\]]+)\]\]/i;
const FORM_MARKER_RE = /\[\[form\s+([^\]]+)\]\]/i;
const FIELD_RE = /(name|email|phone)="([^"]+)"/gi;
const FORM_FIELDS_RE = /fields="([^"]+)"/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][\d\s\-().]{5,}$/;

export type CaptureFieldId = "name" | "email" | "phone";

export interface ParsedFormRequest {
  /** Visitor-visible reply with the [[form …]] marker stripped. */
  cleanText: string;
  /** Null when no form marker was present. */
  fields: CaptureFieldId[] | null;
}

/**
 * Parse the [[form fields="name,email,phone"]] marker the bot emits when
 * it wants to surface a structured inline form to the visitor. Field
 * order in the returned array preserves the bot's order so the widget
 * renders inputs in the requested sequence.
 *
 * Returns the original text untouched + fields=null when no marker is
 * present, so the caller can chain this alongside parseCaptureMarker
 * without special-casing.
 */
export function parseFormMarker(rawText: string): ParsedFormRequest {
  const match = FORM_MARKER_RE.exec(rawText);
  if (!match) return { cleanText: rawText, fields: null };

  const inner = match[1] ?? "";
  const fieldsMatch = FORM_FIELDS_RE.exec(inner);
  const fields: CaptureFieldId[] = [];
  if (fieldsMatch && fieldsMatch[1]) {
    const seen = new Set<string>();
    for (const raw of fieldsMatch[1].split(",")) {
      const f = raw.trim().toLowerCase();
      if ((f === "name" || f === "email" || f === "phone") && !seen.has(f)) {
        seen.add(f);
        fields.push(f);
      }
    }
  }

  const cleanText = rawText
    .replace(FORM_MARKER_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (fields.length === 0) {
    // Marker present but no recognised fields — drop the marker but
    // don't trigger the form (avoids an empty form being rendered).
    return { cleanText, fields: null };
  }

  return { cleanText, fields };
}

export interface ParsedCapture {
  /** The visitor-visible reply with the marker line removed. */
  cleanText: string;
  /** Null if no marker was present, otherwise the extracted fields.
   *  Fields the LLM didn't include come back as null. */
  capture: {
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
}

export function parseCaptureMarker(rawText: string): ParsedCapture {
  const match = MARKER_RE.exec(rawText);
  if (!match) {
    return { cleanText: rawText, capture: null };
  }

  const inner = match[1] ?? "";
  let name: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;

  for (const m of inner.matchAll(FIELD_RE)) {
    const key = m[1]?.toLowerCase();
    const value = m[2]?.trim();
    if (!value) continue;
    if (key === "name") name = value.slice(0, 200);
    else if (key === "email" && EMAIL_RE.test(value)) email = value;
    else if (key === "phone" && PHONE_RE.test(value)) phone = value;
  }

  // Strip the marker and any leading whitespace/blank line it created.
  const cleanText = rawText.replace(MARKER_RE, "").replace(/\n{3,}/g, "\n\n").trim();

  // If the model emitted the marker but with no usable fields, treat as
  // no capture — don't trigger reconciliation on an empty payload.
  if (!name && !email && !phone) {
    return { cleanText, capture: null };
  }

  return { cleanText, capture: { name, email, phone } };
}

export interface ReconcileInput {
  agencyId: string;
  subAccountId: string;
  sessionId: string;
  /** When non-null, the session already has a contact and we skip. */
  existingContactId: string | null;
  pageUrl: string | null;
  capture: NonNullable<ParsedCapture["capture"]>;
}

export interface ReconcileResult {
  contactId: string;
  /** True when this call created a fresh Contact. False when an existing
   *  email-match was reused or the session was already linked. */
  created: boolean;
}

/**
 * Find an existing Contact by email within the sub-account, otherwise
 * create a new one. Always links the session at the end. Safe to call
 * multiple times — short-circuits when existingContactId is set.
 */
export async function reconcileContactFromCapture(
  input: ReconcileInput,
): Promise<ReconcileResult | null> {
  // Already linked — one-shot policy. Subsequent markers ignored.
  if (input.existingContactId) {
    return { contactId: input.existingContactId, created: false };
  }

  // Need at least an email OR phone to reconcile/create. A name alone
  // isn't enough — bot may have hallucinated.
  if (!input.capture.email && !input.capture.phone) return null;

  const db = getAdminDb();

  // Try email match within sub-account first.
  if (input.capture.email) {
    const emailMatch = await db
      .collection("contacts")
      .where("subAccountId", "==", input.subAccountId)
      .where("email", "==", input.capture.email)
      .limit(1)
      .get();
    if (!emailMatch.empty) {
      const contactId = emailMatch.docs[0].id;
      await linkSessionToContact({
        subAccountId: input.subAccountId,
        sessionId: input.sessionId,
        contactId,
        capturedName: input.capture.name,
        capturedEmail: input.capture.email,
        capturedPhone: input.capture.phone,
      });
      return { contactId, created: false };
    }
  }

  // Create a new contact tagged source="web-chat".
  const contactRef = await db.collection("contacts").add({
    name: input.capture.name ?? "",
    email: input.capture.email ?? "",
    phone: input.capture.phone ?? "",
    company: "",
    source: "web-chat",
    tags: [],
    pipelineStage: null,
    attribution: input.pageUrl ? { landingPage: input.pageUrl } : null,
    agencyId: input.agencyId,
    subAccountId: input.subAccountId,
    createdByUid: "web-chat-bot",
    emailOptedOut: false,
    smsOptedOut: false,
    countryCode: null,
    country: null,
    city: null,
    lat: null,
    lng: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await linkSessionToContact({
    subAccountId: input.subAccountId,
    sessionId: input.sessionId,
    contactId: contactRef.id,
    capturedName: input.capture.name,
    capturedEmail: input.capture.email,
    capturedPhone: input.capture.phone,
  });

  return { contactId: contactRef.id, created: true };
}
