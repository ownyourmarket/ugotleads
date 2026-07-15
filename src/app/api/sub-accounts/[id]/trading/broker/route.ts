import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireSubAccountMember } from "@/lib/auth/require-tenancy";
import {
  vibeTradingIsConfigured,
  registerBrokerConnection,
  revokeBrokerConnection,
  VibeTradingError,
} from "@/lib/vibe-trading/client";
import {
  listBrokerConnections,
  createBrokerConnection,
  markBrokerConnected,
  deleteBrokerConnection,
} from "@/lib/trading/store";
import type { BrokerConnectionMode } from "@/types/trading";

export const dynamic = "force-dynamic";

/**
 * Self-directed broker connections. The user links their OWN Alpaca account.
 *
 * COMPLIANCE + SECURITY invariants enforced here:
 *  - Credentials are forwarded to the Vibe service (which vaults them) and
 *    NEVER written to Firestore. Only non-secret status metadata is stored.
 *  - `mode: "live"` requires the agency-level gate
 *    (SubAccountDoc.liveTradingEnabledByAgency === true). Paper is always
 *    allowed. The platform still never places discretionary trades.
 */

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const access = await requireSubAccountMember(request, id);
  if (access instanceof NextResponse) return access;

  const connections = await listBrokerConnections(id);
  const subSnap = await getAdminDb().doc(`subAccounts/${id}`).get();
  const liveEnabled = subSnap.data()?.liveTradingEnabledByAgency === true;

  return NextResponse.json({ connections, liveEnabled });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: subAccountId } = await ctx.params;
  const access = await requireSubAccountMember(request, subAccountId);
  if (access instanceof NextResponse) return access;

  if (!vibeTradingIsConfigured()) {
    return NextResponse.json(
      {
        error:
          "Trading engine is not configured on this deployment (VIBE_TRADING_API_URL / VIBE_TRADING_API_KEY missing).",
      },
      { status: 503 },
    );
  }

  let body: {
    mode?: unknown;
    apiKeyId?: unknown;
    apiSecret?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const mode: BrokerConnectionMode = body.mode === "live" ? "live" : "paper";
  const apiKeyId = typeof body.apiKeyId === "string" ? body.apiKeyId.trim() : "";
  const apiSecret =
    typeof body.apiSecret === "string" ? body.apiSecret.trim() : "";

  if (!apiKeyId || !apiSecret) {
    return NextResponse.json(
      { error: "Both apiKeyId and apiSecret are required." },
      { status: 400 },
    );
  }

  const agencyId = access.agencyId;
  if (!agencyId) {
    return NextResponse.json(
      { error: "Caller has no agency context." },
      { status: 403 },
    );
  }

  // Live gate: only agencies that explicitly enabled live trading can link a
  // real-money account. Paper is always allowed.
  if (mode === "live") {
    const subSnap = await getAdminDb().doc(`subAccounts/${subAccountId}`).get();
    if (subSnap.data()?.liveTradingEnabledByAgency !== true) {
      return NextResponse.json(
        {
          error:
            "Live trading isn't enabled for this workspace yet. You can connect a paper account now.",
        },
        { status: 403 },
      );
    }
  }

  // Create the row first so we have a stable connectionId to hand the service.
  const brokerId = await createBrokerConnection({
    agencyId,
    subAccountId,
    createdByUid: access.uid,
    provider: "alpaca",
    mode,
  });

  try {
    const result = await registerBrokerConnection({
      subAccountId,
      connectionId: brokerId,
      provider: "alpaca",
      mode,
      apiKeyId,
      apiSecret,
    });
    await markBrokerConnected(subAccountId, brokerId, result.accountLabel);
    return NextResponse.json({ brokerId, connected: true, mode });
  } catch (err) {
    // Roll the row back so a failed connect doesn't leave an orphaned entry.
    await deleteBrokerConnection(subAccountId, brokerId).catch(() => {});
    const message =
      err instanceof VibeTradingError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not reach the trading engine.";
    const status = err instanceof VibeTradingError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: subAccountId } = await ctx.params;
  const access = await requireSubAccountMember(request, subAccountId);
  if (access instanceof NextResponse) return access;

  const { searchParams } = new URL(request.url);
  const brokerId = searchParams.get("brokerId");
  if (!brokerId) {
    return NextResponse.json(
      { error: "brokerId query param is required." },
      { status: 400 },
    );
  }

  // Best-effort revoke on the service (idempotent), then drop the row.
  if (vibeTradingIsConfigured()) {
    await revokeBrokerConnection(brokerId).catch(() => {});
  }
  await deleteBrokerConnection(subAccountId, brokerId);
  return NextResponse.json({ ok: true });
}
