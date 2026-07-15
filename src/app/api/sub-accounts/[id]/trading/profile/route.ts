import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireSubAccountAdmin } from "@/lib/auth/require-tenancy";
import {
  getTradingProfile,
  upsertTradingProfile,
} from "@/lib/trading/store";
import type {
  TradingProfile,
  TradingRiskLevel,
  TradingAssetClass,
  TradingMode,
} from "@/types/trading";

export const dynamic = "force-dynamic";

const RISK_LEVELS: TradingRiskLevel[] = [
  "conservative",
  "moderate",
  "aggressive",
];
const ASSET_CLASSES: TradingAssetClass[] = ["stocks", "crypto", "forex"];
// Phase A: "live" is intentionally NOT selectable via this route. It only
// unlocks once the agency enables live trading + a broker connection exists.
const ALLOWED_MODES: TradingMode[] = ["research_only", "paper"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Trading OS shared risk profile. One per sub-account. Members read via
 * onSnapshot; writes are admin-only through this route (Admin SDK) so the
 * server can enforce the compliance invariants (no "live" mode, disclaimer
 * gating) before persisting.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  const profile = await getTradingProfile(id);
  return NextResponse.json({ profile });
}

function sanitisePatch(input: Record<string, unknown>): Partial<TradingProfile> {
  const patch: Partial<TradingProfile> = {};

  if (
    "riskLevel" in input &&
    typeof input.riskLevel === "string" &&
    RISK_LEVELS.includes(input.riskLevel as TradingRiskLevel)
  ) {
    patch.riskLevel = input.riskLevel as TradingRiskLevel;
  }

  if ("allowedAssetClasses" in input && Array.isArray(input.allowedAssetClasses)) {
    const cleaned = input.allowedAssetClasses.filter(
      (v): v is TradingAssetClass =>
        typeof v === "string" && ASSET_CLASSES.includes(v as TradingAssetClass),
    );
    // De-dup while preserving order.
    patch.allowedAssetClasses = Array.from(new Set(cleaned));
  }

  if (
    "strategyPreferences" in input &&
    typeof input.strategyPreferences === "string"
  ) {
    patch.strategyPreferences = input.strategyPreferences.slice(0, 4000);
  }

  if ("dataSourceKeys" in input && Array.isArray(input.dataSourceKeys)) {
    patch.dataSourceKeys = input.dataSourceKeys
      .filter((v): v is string => typeof v === "string")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);
  }

  for (const key of ["defaultBacktestStart", "defaultBacktestEnd"] as const) {
    if (key in input) {
      const raw = input[key];
      if (raw === null || raw === "") {
        patch[key] = null;
      } else if (typeof raw === "string" && ISO_DATE.test(raw)) {
        patch[key] = raw;
      }
    }
  }

  if (
    "mode" in input &&
    typeof input.mode === "string" &&
    ALLOWED_MODES.includes(input.mode as TradingMode)
  ) {
    patch.mode = input.mode as TradingMode;
  }

  return patch;
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const auth = await requireSubAccountAdmin(request, id);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch = sanitisePatch(body);

  // Disclaimer acknowledgement is a dedicated, one-way action.
  if (body.acceptDisclaimer === true) {
    (patch as Partial<TradingProfile>).disclaimerAcceptedAt =
      FieldValue.serverTimestamp();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No valid fields in patch" },
      { status: 400 },
    );
  }

  await upsertTradingProfile(id, patch);
  const profile = await getTradingProfile(id);
  return NextResponse.json({ profile });
}
