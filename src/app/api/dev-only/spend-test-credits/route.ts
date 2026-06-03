import "server-only";

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { spendCredits } from "@/lib/credits/server";
import type { MemberStatus, Role } from "@/types";

/**
 * Dev-only: Test the spendCredits() helper against the caller's own wallet.
 *
 * Uses the caller's uid as the partnerProfileId — the caller must be an
 * active agency owner with an initialized credit wallet.
 *
 * ── Security model ──────────────────────────────────────────────────────────
 *
 * Guard 1 — Environment gate:
 *   Returns 403 when NODE_ENV === "production" unless
 *   REVENUE_OS_SEED_ALLOW_PRODUCTION=true is explicitly set.
 *
 * Guard 2 — Owner auth gate:
 *   agencyRole must be "owner". Partners cannot trigger spend operations
 *   on their own wallets through this route.
 *
 * Guard 3 — dryRun default:
 *   dryRun defaults to true. Pass { "dryRun": false } to perform a real spend.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 * Live writes use a deterministic operationId:
 *   `test_spend_${uid}_${amount}`
 * Re-running with dryRun: false returns { skipped } on the second call.
 * To run a new spend, change the amount.
 *
 * ── Endpoint ────────────────────────────────────────────────────────────────
 *
 * POST /api/dev-only/spend-test-credits
 *   Body (all optional):
 *   {
 *     dryRun?: boolean,       // default true
 *     amount?: number,        // default 5
 *     reason?: string,        // default "Dev test spend"
 *   }
 *
 * ── Usage (browser DevTools console) ────────────────────────────────────────
 *
 *   // Dry-run — preview without spending:
 *   fetch('/api/dev-only/spend-test-credits', {
 *     method: 'POST',
 *     credentials: 'include',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ dryRun: true }),
 *   }).then(r => r.json()).then(console.log);
 *
 *   // Live spend — 5 credits:
 *   fetch('/api/dev-only/spend-test-credits', {
 *     method: 'POST',
 *     credentials: 'include',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ dryRun: false }),
 *   }).then(r => r.json()).then(console.log);
 *
 *   // Live spend — custom amount (also tests idempotency if re-run):
 *   fetch('/api/dev-only/spend-test-credits', {
 *     method: 'POST',
 *     credentials: 'include',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ dryRun: false, amount: 10, reason: 'AI run simulation' }),
 *   }).then(r => r.json()).then(console.log);
 */

const DEFAULT_AMOUNT = 5;

interface CallerClaims {
  role?: Role;
  status?: MemberStatus;
  agencyRole?: "owner" | "staff" | null;
  agencyId?: string | null;
}

function isProductionLocked(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.REVENUE_OS_SEED_ALLOW_PRODUCTION !== "true"
  );
}

async function requireOwner(
  request: Request,
): Promise<{ uid: string; agencyId: string } | NextResponse> {
  const uid = request.headers.get("x-user-uid");
  if (!uid)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const record = await getAdminAuth().getUser(uid).catch(() => null);
  if (!record)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const claims = (record.customClaims ?? {}) as CallerClaims;
  if (claims.status !== "active")
    return NextResponse.json({ error: "Account inactive." }, { status: 403 });
  if (claims.agencyRole !== "owner" || !claims.agencyId)
    return NextResponse.json(
      { error: "Agency owner access required." },
      { status: 403 },
    );

  return { uid, agencyId: claims.agencyId };
}

export async function POST(request: Request) {
  // Guard 1 — production lock
  if (isProductionLocked()) {
    return NextResponse.json(
      {
        error:
          "This route is disabled in production. Set REVENUE_OS_SEED_ALLOW_PRODUCTION=true to override.",
      },
      { status: 403 },
    );
  }

  // Guard 2 — owner auth
  const auth = await requireOwner(request);
  if (auth instanceof NextResponse) return auth;
  const { uid, agencyId } = auth;

  // Parse body
  let body: {
    dryRun?: boolean;
    amount?: number;
    reason?: string;
  };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // Guard 3 — dryRun defaults to true
  const dryRun = body.dryRun !== false;
  const amount = Math.max(1, Math.floor(body.amount ?? DEFAULT_AMOUNT));
  const reason = body.reason?.trim() || "Dev test spend via /api/dev-only/spend-test-credits";

  // Deterministic operationId — idempotent on re-run with same amount
  const operationId = `test_spend_${uid}_${amount}`;

  const db = getAdminDb();

  // Fetch wallet info for the preview (and pre-flight check)
  const walletSnap = await db.doc(`credit_wallets/${uid}`).get().catch(() => null);
  const walletExists = walletSnap?.exists ?? false;
  const currentBalance = walletExists
    ? ((walletSnap!.data() as { balanceCredits?: number }).balanceCredits ?? 0)
    : 0;

  // Check for existing transaction (idempotency pre-check for display)
  const existingTxnSnap = await db.doc(`credit_transactions/${operationId}`).get().catch(() => null);
  const alreadyExecuted = existingTxnSnap?.exists ?? false;

  const preflightWarnings: string[] = [];
  if (!walletExists) {
    preflightWarnings.push(`credit_wallets/${uid} not found — initialize a wallet first via /agency/credits`);
  }
  if (walletExists && currentBalance < amount) {
    preflightWarnings.push(
      `Insufficient balance: wallet has ${currentBalance} credits, spend requires ${amount}`,
    );
  }
  if (alreadyExecuted) {
    preflightWarnings.push(
      `operationId "${operationId}" already executed — re-running will return { skipped }`,
    );
  }

  // ── Dry-run ───────────────────────────────────────────────────────────────
  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      operationId,
      amount,
      reason,
      walletInfo: {
        exists: walletExists,
        currentBalance,
        balanceAfterSpend: walletExists ? Math.max(0, currentBalance - amount) : null,
      },
      alreadyExecuted,
      preflightWarnings,
      note:
        preflightWarnings.length === 0
          ? "✅ Preflight OK. Set dryRun: false to execute the spend."
          : `⚠️ ${preflightWarnings.length} preflight warning(s). Fix before running dryRun: false.`,
    });
  }

  // ── Live spend ────────────────────────────────────────────────────────────
  const result = await spendCredits({
    agencyId,
    partnerProfileId: uid,
    subAccountId: null,
    amount,
    reason,
    operationId,
    metadata: {
      source: "dev_test",
      feature: "credit_spend_test",
      operationId,
      callerUid: uid,
    },
  });

  if ("ok" in result) {
    return NextResponse.json({
      dryRun: false,
      status: "ok",
      operationId,
      amount,
      newBalance: result.newBalance,
      transactionId: result.transactionId,
      note: `Spent ${amount} credits. New balance: ${result.newBalance}. View at /sa/*/credits`,
    });
  }

  if ("skipped" in result) {
    return NextResponse.json({
      dryRun: false,
      status: "skipped",
      operationId,
      reason: result.reason,
      note: `Already executed (idempotent). To run again, change the amount.`,
    });
  }

  if ("insufficient_balance" in result) {
    return NextResponse.json(
      {
        dryRun: false,
        status: "insufficient_balance",
        currentBalance: result.currentBalance,
        required: result.required,
        note: `Add credits first via /agency/credits → Adjust.`,
      },
      { status: 422 },
    );
  }

  if ("wallet_not_found" in result) {
    return NextResponse.json(
      {
        dryRun: false,
        status: "wallet_not_found",
        note: `Initialize the wallet first via /agency/credits → Initialize.`,
      },
      { status: 404 },
    );
  }

  // error
  return NextResponse.json(
    { dryRun: false, status: "error", message: result.message },
    { status: 500 },
  );
}
