import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { withAgentRoute } from "@/lib/agent-api/route-wrapper";
import { requireServiceAuth } from "@/lib/auth/require-service-auth";
import { computeReadiness } from "@/lib/readiness/compute";
import { loadDomainCounts } from "@/lib/control-plane/counts";

/**
 * GET /api/agent/v1/control-plane/summary
 *
 * Read-only Revenue OS health snapshot for the MyUSA OS control plane:
 * per-domain counts plus the launch-readiness checklist (shared with the
 * owner cockpit's /api/agency/readiness — same computation, cannot drift).
 *
 * Agency-scoped: control-plane collections are keyed by agencyId, so no
 * subAccountId is required and the key's sub-account allowlist does not
 * apply here. Secrets are reported as booleans only; no PII, no BYOK key
 * material, no MLM semantics.
 */
export const GET = withAgentRoute(async (request: Request) => {
  const access = await requireServiceAuth(request, { scope: "control_plane:read" });
  if (access instanceof NextResponse) return access;

  const db = getAdminDb();
  const [readiness, domainCounts] = await Promise.all([
    computeReadiness(db, access.agencyId),
    loadDomainCounts(db, access.agencyId),
  ]);

  return NextResponse.json({
    data: {
      counts: domainCounts.counts,
      readiness,
      truncated: domainCounts.truncated,
    },
  });
});
