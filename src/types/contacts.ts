import type { Timestamp, FieldValue } from "firebase/firestore";

/**
 * How a Contact entered the CRM. Stored as a free-form string on the doc
 * (so a UTM source like "google" can flow through) but the union below
 * names the values the UI has explicit badges / labels for.
 *
 *   - "website-form"  Submitted a public hosted form at /f/[id]. (Preferred.)
 *   - "web-chat"      Captured via the AI Agents web chat widget.
 *   - "website"       Legacy generic — predates the form/chat split. Still
 *                     selectable in the manual-create UI as a catch-all.
 *   - "referral" / "ads" / "other"  Manual-entry options.
 *   - ""              Unknown — no badge rendered.
 */
export type ContactSource =
  | "website-form"
  | "web-chat"
  | "website"
  | "referral"
  | "ads"
  | "other"
  | "";

/**
 * Marketing attribution captured at contact creation time. Populated by
 * /api/forms/[id]/submit when the hosted form page (/f/[id]) forwards
 * the original URL params + referrer from the visit that converted.
 *
 * All fields are nullable — contacts created via CSV import, manual
 * entry, or pre-attribution-capture submissions will have null values.
 * Stored on the contact (not the submission) so downstream events like
 * pipeline-stage changes can reference the original attribution when
 * firing Meta Conversions API events.
 */
export interface ContactAttribution {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  fbclid: string | null;
  gclid: string | null;
  landingPage: string | null;
  referrer: string | null;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  source: ContactSource;
  tags: string[];
  pipelineStage: string | null;
  attribution: ContactAttribution | null;
  // Tenancy keys (replace the legacy ownerId).
  agencyId: string;
  subAccountId: string;
  createdByUid: string;
  // Compliance flags. Flipped by the unsubscribe page (email) and the
  // Twilio inbound webhook (sms STOP). The automation step executor
  // checks these before sending and logs `automation_step_skipped`.
  emailOptedOut: boolean;
  smsOptedOut: boolean;
  /**
   * Voice opt-out. Optional/absent reads as not-opted-out. Set when a
   * contact asks not to be called by the AI voice agent. Added by the
   * voice port. */
  voiceOptedOut?: boolean;
  /**
   * Timestamp of the last outbound AI voice call. Powers "recently
   * contacted" suppression on bulk campaigns without scanning every
   * campaign. Undefined = never called. Added by the voice port. */
  lastOutboundCallAt?: Timestamp | FieldValue | null;
  /**
   * Best-effort location, captured at contact creation. Populated by
   * /api/forms/[id]/submit via ipapi.co (city + lat/lng) with a phone
   * country-code fallback (country only, lat/lng resolved to country
   * centroid client-side). Null for contacts created before location
   * capture shipped, or when neither path resolved.
   */
  countryCode: string | null;
  country: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

export type ContactFormData = Pick<
  Contact,
  "name" | "email" | "phone" | "company" | "source" | "tags"
>;

export type ActivityType =
  | "note_added"
  | "booking_created"
  | "pipeline_moved"
  | "task_completed"
  | "form_submitted"
  | "email_sent"
  | "sms_sent"
  | "automation_started"
  | "automation_step_sent"
  | "automation_step_skipped"
  | "automation_completed"
  | "automation_failed"
  | "email_opened"
  | "link_clicked"
  | "email_reply"
  | "ai_reply_sent"
  | "ai_escalated"
  | "ai_skipped";

export interface Note {
  id: string;
  content: string;
  createdBy: string;
  createdAt: Timestamp | FieldValue | null;
}

export interface ActivityItem {
  id: string;
  type: ActivityType;
  content: string;
  createdAt: Timestamp | FieldValue | null;
  createdBy: string;
}

/**
 * Audit log entry for a CSV contact import. One row per import action.
 * Stored in the top-level `import_logs` collection, scoped by tenancy keys.
 */
export interface ImportLog {
  id: string;
  agencyId: string;
  subAccountId: string;
  /** UID of the user who ran the import. */
  importedByUid: string;
  /** Display name of the importer (snapshot — survives user deletion). */
  importedByName: string;
  /** Original CSV filename. */
  fileName: string;
  /** Total rows in the CSV (excluding header). */
  totalRows: number;
  /** Contacts successfully created. */
  created: number;
  /** Rows skipped (invalid email, duplicate, etc.). */
  skipped: number;
  /** First few error messages (capped at 5). */
  errors: string[];
  createdAt: Timestamp | FieldValue | null;
}
