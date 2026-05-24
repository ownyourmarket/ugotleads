import type { Timestamp, FieldValue } from "firebase/firestore";

/**
 * v1 ships only "instant_response". v2 will extend this union with
 * "nurture", "stage_trigger", "booking_lifecycle", "stale_revive".
 */
export type RecipeType = "instant_response";

export type AutomationTriggerType = "form_submit";

export type AutomationStatus = "running" | "completed" | "stopped" | "failed";

export type StoppedReason =
  | "automation_disabled"
  | "manual"
  | "opt_out"
  | "booking";

export interface AutomationTrigger {
  type: AutomationTriggerType;
  /** Required when type === "form_submit". */
  formId: string | null;
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

export type RecipeConfig = InstantResponseConfig;

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
