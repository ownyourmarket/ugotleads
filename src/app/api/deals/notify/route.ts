import "server-only";

import { NextResponse } from "next/server";
import { createNotification } from "@/lib/notifications/create";

/**
 * POST /api/deals/notify
 *
 * Fire-and-forget notification when a deal moves to won or lost.
 * Called client-side after moveDeal() succeeds.
 *
 * Body: { subAccountId, dealTitle, contactName, stageId, value?, currency? }
 */
export async function POST(request: Request) {
  const uid = request.headers.get("x-user-uid");
  if (!uid) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    subAccountId?: string;
    dealTitle?: string;
    contactName?: string;
    stageId?: string;
    value?: number;
    currency?: string;
  } | null;

  if (!body?.subAccountId || !body.dealTitle || !body.stageId) {
    return NextResponse.json(
      { error: "subAccountId, dealTitle, and stageId are required." },
      { status: 400 },
    );
  }

  const { subAccountId, dealTitle, contactName, stageId, value, currency } = body;

  if (stageId !== "won" && stageId !== "lost") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const isWon = stageId === "won";
  const valueStr =
    value && currency
      ? ` (${new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value)})`
      : "";

  try {
    await createNotification({
      subAccountId,
      type: isWon ? "deal_won" : "deal_lost",
      title: isWon ? `Deal won${valueStr}` : "Deal lost",
      message: `"${dealTitle}"${contactName ? ` with ${contactName}` : ""} was marked as ${isWon ? "won" : "lost"}.`,
      linkTo: "/pipeline",
    });
  } catch (err) {
    // Best-effort — don't fail the response.
    console.warn("[deals/notify] notification failed", err);
  }

  return NextResponse.json({ ok: true });
}
