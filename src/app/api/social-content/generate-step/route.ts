/**
 * POST /api/social-content/generate-step
 *
 * QStash signature-verified callback that generates one week of social
 * content posts. Phase 1 stub.
 *
 * TODO (next session):
 * - Verify Upstash-Signature header via @upstash/qstash receiver
 * - Idempotency check on the batch doc's existing posts for the given week
 * - Load businessProfile + cadence from Firestore
 * - Build system prompt + week prompt (lib/social-content/prompts)
 * - Call OpenRouter via lib/comms/ai/openrouter::callAi() with Sonnet 4.7
 * - Parse with lib/social-content/schema::parseGeneratedPosts()
 * - Atomic Firestore update: append posts + update progress
 * - If weekIndex < weeks-1, schedule next; else mark ready
 *
 * This route is added to PUBLIC_PATH_PATTERNS in middleware.ts —
 * security comes from the QStash signature, not session auth.
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      error: "not_implemented",
      message:
        "AI Social Content Generator step executor is in Phase 1 development. " +
        "See docs/social-content-generator-spec.md.",
    },
    { status: 501 },
  );
}
