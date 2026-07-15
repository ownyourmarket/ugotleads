import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  DEFAULT_TRADING_PROFILE,
  type TradingProfile,
  type TradingRun,
  type TradingRunResult,
  type TradingRunStatus,
  type TradingRunType,
  type TradingRiskLevel,
} from "@/types/trading";

/**
 * Trading OS Firestore access. Server-only — routes call these, never the
 * client (rules are members-read / server-only-write, mirroring aiAgent/*).
 *
 *   profile: subAccounts/{id}/tradingAgent/profile
 *   runs:    subAccounts/{id}/tradingRuns/{runId}
 */

const PROFILE_DOC = "profile";

function profilePath(subAccountId: string): string {
  return `subAccounts/${subAccountId}/tradingAgent/${PROFILE_DOC}`;
}

function runsCollection(subAccountId: string): string {
  return `subAccounts/${subAccountId}/tradingRuns`;
}

// ============================================================
// Profile
// ============================================================

export async function getTradingProfile(
  subAccountId: string,
): Promise<TradingProfile | null> {
  const snap = await getAdminDb().doc(profilePath(subAccountId)).get();
  if (!snap.exists) return null;
  return snap.data() as TradingProfile;
}

export async function upsertTradingProfile(
  subAccountId: string,
  patch: Partial<TradingProfile>,
): Promise<void> {
  const ref = getAdminDb().doc(profilePath(subAccountId));
  const existing = await ref.get();
  const seed = existing.exists
    ? {}
    : {
        ...DEFAULT_TRADING_PROFILE,
        disclaimerAcceptedAt: null,
        createdAt: FieldValue.serverTimestamp(),
      };
  await ref.set(
    { ...seed, ...patch, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

// ============================================================
// Runs
// ============================================================

export interface CreateRunInput {
  agencyId: string;
  subAccountId: string;
  createdByUid: string;
  prompt: string;
  runType: TradingRunType;
  riskLevel: TradingRiskLevel;
}

/** Creates a queued run row and returns its generated id. */
export async function createTradingRun(
  input: CreateRunInput,
): Promise<string> {
  const ref = getAdminDb().collection(runsCollection(input.subAccountId)).doc();
  const doc: Omit<TradingRun, "id"> = {
    agencyId: input.agencyId,
    subAccountId: input.subAccountId,
    createdByUid: input.createdByUid,
    prompt: input.prompt,
    runType: input.runType,
    riskLevel: input.riskLevel,
    vibeJobId: null,
    status: "queued",
    result: null,
    resultSummaryMd: null,
    error: null,
    pollAttempts: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.set(doc);
  return ref.id;
}

export async function getTradingRun(
  subAccountId: string,
  runId: string,
): Promise<TradingRun | null> {
  const snap = await getAdminDb()
    .doc(`${runsCollection(subAccountId)}/${runId}`)
    .get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<TradingRun, "id">) };
}

export async function updateTradingRun(
  subAccountId: string,
  runId: string,
  patch: Partial<
    Pick<
      TradingRun,
      | "vibeJobId"
      | "status"
      | "result"
      | "resultSummaryMd"
      | "error"
      | "pollAttempts"
    >
  >,
): Promise<void> {
  await getAdminDb()
    .doc(`${runsCollection(subAccountId)}/${runId}`)
    .set(
      { ...patch, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
}

/** Convenience: mark a run terminal with a poll result. */
export async function settleTradingRun(
  subAccountId: string,
  runId: string,
  status: Extract<TradingRunStatus, "done" | "failed">,
  fields: {
    result?: TradingRunResult | null;
    resultSummaryMd?: string | null;
    error?: string | null;
  },
): Promise<void> {
  await updateTradingRun(subAccountId, runId, {
    status,
    result: fields.result ?? null,
    resultSummaryMd: fields.resultSummaryMd ?? null,
    error: fields.error ?? null,
  });
}
