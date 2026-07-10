import type { Timestamp, FieldValue } from "firebase/firestore";

/**
 * Three recipes ship: "instant_response" (immediate reply to a new lead),
 * "lead_nurture" (form-triggered drip), and "outbound_sequence" (manual or
 * tag-enrolled cold outreach that stops on reply).
 */
export type RecipeType =
  | "instant_response"
  | "lead_nurture"
  | "outbound_sequence";

export type AutomationTriggerType = "form_submit" | "manual" | "tag_added";

export type AutomationStatus = "running" | "completed" | "stopped" | "failed";

export type StoppedReason =
  | "automation_disabled"
  | "manual"
  | "opt_out"
  | "booking"
  | "replied";

export interface AutomationTrigger {
  type: AutomationTriggerType;
  /** Required when type === "form_submit". */
  formId: string | null;
  /** Required when type === "tag_added" — the tag that enrolls a contact. */
  tag?: string | null;
}

/**
 * Recipe 1 config. Each step is optional — the agency operator picks which
 * channels fire and at what delay. v1 supports lead SMS, lead email, and an
 * owner notification (sent to a static address).
 */
export interface InstantResponseConfig {
  leadSms: { templateId: string; delaySeconds: number } | null;
  leadEmail: { templateId: string; delaySeconds: number } | null;
  ownerNotify: {
    channel: "sms" | "email";
    templateId: string;
    /** Owner email or phone in E.164. */
    recipient: string;
  } | null;
}

/**
 * Recipe 2 config — Lead Nurture. A multi-step drip sequence that fires
 * over days/weeks after a form submission. Each step sends an email or SMS
 * at a configurable delay from the trigger.
 */
export interface LeadNurtureStep {
  channel: StepChannel;
  templateId: string;
  /** Delay in seconds from the TRIGGER (not from the previous step). */
  delaySeconds: number;
}

export interface LeadNurtureConfig {
  steps: LeadNurtureStep[];
}

/**
 * Recipe 3 — Outbound Sequence. Same step shape as lead nurture (delays are
 * absolute from ENROLLMENT), but enrollment is manual/tag-based (cold lists)
 * instead of form-triggered, enrollment is once-per-contact-ever, and a
 * reply from the contact stops the sequence (stoppedReason "replied").
 * Email-only in v1 (SMS pending A2P).
 */
export type OutboundSequenceConfig = LeadNurtureConfig;

export type RecipeConfig =
  | InstantResponseConfig
  | LeadNurtureConfig
  | OutboundSequenceConfig;

export interface AutomationDoc {
  id: string;
  agencyId: string;
  subAccountId: string;
  recipeType: RecipeType;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  config: RecipeConfig;
  createdByUid: string;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}

export type StepChannel = "email" | "sms";

export interface ExecutionStepHistoryEntry {
  stepIndex: number;
  channel: StepChannel;
  templateId: string;
  recipient: string;
  sentAt: Timestamp | FieldValue | null;
  success: boolean;
  /** Set when success === false. */
  error?: string | null;
  /** Set when the executor short-circuited the send. */
  skippedReason?: "opt_out" | "missing_field" | "automation_disabled" | null;
}

export interface ExecutionDoc {
  id: string;
  agencyId: string;
  subAccountId: string;
  automationId: string;
  contactId: string;
  status: AutomationStatus;
  currentStepIndex: number;
  /** Server-rendered ISO timestamp for the next scheduled step (null if done). */
  nextStepDueAt: Timestamp | FieldValue | null;
  /** Last QStash messageId; useful for cancellation in v2. */
  qstashMessageId: string | null;
  history: ExecutionStepHistoryEntry[];
  startedAt: Timestamp | FieldValue | null;
  completedAt: Timestamp | FieldValue | null;
  stoppedReason: StoppedReason | null;
}

export interface MessageTemplateDoc {
  id: string;
  agencyId: string;
  subAccountId: string;
  type: StepChannel;
  name: string;
  /** Email only; ignored on SMS templates. */
  subject: string | null;
  body: string;
  createdByUid: string;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}
