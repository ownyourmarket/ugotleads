import "server-only";

import type { Detector, ControlPlaneIssue } from "../types";
import { toMillis } from "../types";

const RETRY_WARN_THRESHOLD = 5;
const STUCK_PENDING_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Partner network event outbox health. The outbox is the clean seam to a
 * FUTURE external partner network engine — events are facts only, no MLM
 * semantics, and this detector only reports delivery health.
 *
 * - partner_event_failed: exporter marked the event failed.
 * - partner_event_stuck_pending: pending event older than 7 days (or with
 *   an unusually high exportAttempts count) — the outbox is not draining.
 */
export const partnerEventsDetector: Detector = {
  domain: "partner_events",
  async run(ctx) {
    const [failedSnap, pendingSnap] = await Promise.all([
      ctx.db
        .collection("partner_network_events")
        .where("agencyId", "==", ctx.agencyId)
        .where("status", "==", "failed")
        .select("eventType", "exportAttempts", "errorMessage", "createdAt")
        .limit(ctx.maxDocs)
        .get(),
      ctx.db
        .collection("partner_network_events")
        .where("agencyId", "==", ctx.agencyId)
        .where("status", "==", "pending")
        .select("eventType", "exportAttempts", "createdAt")
        .limit(ctx.maxDocs)
        .get(),
    ]);

    const issues: ControlPlaneIssue[] = [];

    for (const doc of failedSnap.docs) {
      const e = doc.data() as {
        eventType?: string;
        exportAttempts?: number;
        errorMessage?: string | null;
      };
      issues.push({
        domain: "partner_events",
        issue_code: "partner_event_failed",
        source_entity_type: "event",
        source_entity_id: doc.id,
        display_name: e.eventType ?? doc.id,
        status: "failed",
        severity: "critical",
        summary: `Partner network event "${e.eventType ?? doc.id}" failed export${e.errorMessage ? `: ${e.errorMessage}` : ""}.`,
        safe_action_url: "/agency/partner-network-events",
        metadata: { exportAttempts: e.exportAttempts ?? 0 },
      });
    }

    for (const doc of pendingSnap.docs) {
      const e = doc.data() as {
        eventType?: string;
        exportAttempts?: number;
        createdAt?: unknown;
      };
      const createdMs = toMillis(e.createdAt);
      const stuckByAge = createdMs !== null && ctx.now - createdMs > STUCK_PENDING_MS;
      const stuckByRetries = (e.exportAttempts ?? 0) >= RETRY_WARN_THRESHOLD;
      if (stuckByAge || stuckByRetries) {
        issues.push({
          domain: "partner_events",
          issue_code: "partner_event_stuck_pending",
          source_entity_type: "event",
          source_entity_id: doc.id,
          display_name: e.eventType ?? doc.id,
          status: "pending",
          severity: "warning",
          summary: `Partner network event "${e.eventType ?? doc.id}" is stuck pending${stuckByRetries ? ` after ${e.exportAttempts} export attempts` : " for over 7 days"}.`,
          safe_action_url: "/agency/partner-network-events",
          metadata: { exportAttempts: e.exportAttempts ?? 0 },
        });
      }
    }

    return {
      issues,
      truncated: failedSnap.size >= ctx.maxDocs || pendingSnap.size >= ctx.maxDocs,
    };
  },
};
