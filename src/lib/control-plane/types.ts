import "server-only";

import type { Firestore } from "firebase-admin/firestore";

/**
 * Control-plane read models.
 *
 * These types back the read-only /api/agent/v1/control-plane/* routes that
 * MyUSA OS consumes. Issue rows use snake_case field names — they are an
 * external contract (docs/control-plane spec §6 in the MyUSA OS repo), not
 * internal Firestore shapes.
 *
 * Hard rules: read-only; no PII (no emails/phones); no BYOK key material
 * (detectors read the product_eligibility safe mirrors, never byok_keys);
 * no MLM semantics.
 */

export type IssueSeverity = "info" | "warning" | "critical";

export type ControlPlaneDomain =
  | "products"
  | "fulfillment"
  | "partners"
  | "commissions"
  | "credits"
  | "byok"
  | "partner_events";

export const CONTROL_PLANE_DOMAINS: ControlPlaneDomain[] = [
  "products",
  "fulfillment",
  "partners",
  "commissions",
  "credits",
  "byok",
  "partner_events",
];

export interface ControlPlaneIssue {
  domain: ControlPlaneDomain;
  /** Stable machine code, e.g. "paid_purchase_unfulfilled". */
  issue_code: string;
  source_entity_type:
    | "product"
    | "purchase"
    | "partner"
    | "commission"
    | "wallet"
    | "eligibility"
    | "event";
  source_entity_id: string;
  /** Safe label — never an email or phone number. */
  display_name: string;
  status: string;
  severity: IssueSeverity;
  summary: string;
  /** uGotLeads admin route the operator should open. Path only, no tokens. */
  safe_action_url: string;
  /** Minimal safe fields only — JSON primitives. */
  metadata?: Record<string, string | number | boolean | null>;
}

export interface DetectorContext {
  db: Firestore;
  agencyId: string;
  /** Epoch millis for threshold comparisons — injected for testability. */
  now: number;
  /** Per-collection query bound. */
  maxDocs: number;
}

export interface DetectorResult {
  issues: ControlPlaneIssue[];
  /** True when any query hit maxDocs — results may under-report. */
  truncated: boolean;
}

export interface Detector {
  domain: ControlPlaneDomain;
  run(ctx: DetectorContext): Promise<DetectorResult>;
}

const SEVERITY_RANK: Record<IssueSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** Deterministic ordering: severity first, then domain, code, entity id. */
export function sortIssues(issues: ControlPlaneIssue[]): ControlPlaneIssue[] {
  return [...issues].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.domain.localeCompare(b.domain) ||
      a.issue_code.localeCompare(b.issue_code) ||
      a.source_entity_id.localeCompare(b.source_entity_id),
  );
}

/**
 * Tolerant timestamp reader. Firestore Admin returns Timestamp (has
 * toMillis); tests and legacy docs may hold Date, epoch number, or
 * {seconds} shapes. Null when absent or unreadable.
 */
export function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object") {
    const v = value as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof v.toMillis === "function") {
      try {
        return v.toMillis();
      } catch {
        return null;
      }
    }
    const seconds = typeof v.seconds === "number" ? v.seconds : v._seconds;
    if (typeof seconds === "number") return seconds * 1000;
  }
  return null;
}
