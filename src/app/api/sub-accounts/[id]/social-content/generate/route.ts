/**
 * POST /api/sub-accounts/[id]/social-content/generate
 *
 * Phase 1 stub. Creates the batch doc and schedules the first week's
 * QStash callback. See docs/social-content-generator-spec.md for full
 * implementation plan.
 *
 * TODO (next session):
 * - Wire requireSubAccountAdmin() auth guard
 * - Wire admin SDK Firestore write of subAccounts/{id}/socialContent/{batchId}
 * - Wire qstashPublish() of the first generate-step message
 * - Add request-body validation via Zod
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return NextResponse.json(
    {
      error: "not_implemented",
      message:
        "AI Social Content Generator is in Phase 1 development. " +
        "See docs/social-content-generator-spec.md for build plan.",
      subAccountId: id,
    },
    { status: 501 },
  );
}
