import type { Timestamp, FieldValue } from "firebase/firestore";

/**
 * One received email, stored by the Resend inbound webhook in the
 * top-level `inbound_emails` collection. Matched replies carry contact +
 * tenancy ids; unmatched ones keep nulls and are stored for triage.
 */
export interface InboundEmailDoc {
  id: string;
  agencyId: string | null;
  subAccountId: string | null;
  contactId: string | null;
  /** How the contact was identified. */
  matchedBy: "reply_token" | "email_lookup" | null;
  /** Parsed sender email (lowercased) and raw From header. */
  fromEmail: string;
  fromRaw: string;
  /** All recipient addresses from the To header. */
  to: string[];
  subject: string;
  text: string;
  html: string | null;
  /** Resend identifiers, for audit / dedupe. */
  resendEmailId: string | null;
  messageId: string | null;
  handled: boolean;
  receivedAt: Timestamp | FieldValue | null;
  createdAt: Timestamp | FieldValue | null;
}
