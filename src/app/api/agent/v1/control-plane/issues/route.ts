import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import { requireServiceAuth } from "@/lib/auth/require-service-auth";
import { runDetectors } from "@/lib/control-plane/detectors";
import {
  CONTROL_PLANE_DOMAINS,
  type ControlPlaneDomain,
  type IssueSeverity,
} from "@/lib/control-plane/types";

const SEVERITIES: IssueSeverity[] = ["info", "warning", "critical"];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_DOCS = 2000;

/**
 * GET /api/agent/v1/control-plane/issues
 *
 * Read-only normalized issue rows for the MyUSA OS control plane. Each row
 * carries a stable issue_code, severity, and a safe_action_url pointing at
 * the uGotLeads admin page where a human fixes it. This route never
 * mutates anything and never returns PII or key material.
 *
 * Query params:
 * - domain:   one of products|fulfillment|partners|commissions|credits|byok|partner_events
 * - severity: one of info|warning|critical
 * - limit:    1-200, default 50
 */
export const GET = withAgentRoute(async (request: Request) => {
  const url = new URL(request.url);

  const domainParam = url.searchParams.get("domain");
  if (domainParam !== null && !CONTROL_PLANE_DOMAINS.includes(domainParam as ControlPlaneDomain)) {
    return agentError(
      "VALIDATION_FAILED",
      `Invalid domain. Valid: ${CONTROL_PLANE_DOMAINS.join(", ")}.`,
      400,
    );
  }
  const domain = (domainParam as ControlPlaneDomain | null) ?? undefined;

  const severityParam = url.searchParams.get("severity");
  if (severityParam !== null && !SEVERITIES.includes(severityParam as IssueSeverity)) {
    return agentError(
      "VALIDATION_FAILED",
      `Invalid severity. Valid: ${SEVERITIES.join(", ")}.`,
      400,
    );
  }
  const severity = severityParam as IssueSeverity | null;

  const limitParam = url.searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      return agentError(
        "VALIDATION_FAILED",
        `limit must be an integer between 1 and ${MAX_LIMIT}.`,
        400,
      );
    }
    limit = parsed;
  }

  const access = await requireServiceAuth(request, { scope: "control_plane:read" });
  if (access instanceof NextResponse) return access;

  const result = await runDetectors(
    { db: getAdminDb(), agencyId: access.agencyId, now: Date.now(), maxDocs: MAX_DOCS },
    domain,
  );

  const filtered = severity
    ? result.issues.filter((i) => i.severity === severity)
    : result.issues;

  return NextResponse.json({
    data: filtered.slice(0, limit),
    total: filtered.length,
    truncated: result.truncated || filtered.length > limit,
  });
});
