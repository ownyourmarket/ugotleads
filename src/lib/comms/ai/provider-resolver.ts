import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { AiProviderMode } from "@/types/tenancy";

/**
 * AI Provider Resolver — single chokepoint for every callAi() invocation.
 *
 * Responsibilities:
 *   1. Determine which OpenRouter API key to use for this sub-account
 *      (hosted = agency env key, or BYOK = operator's own key).
 *   2. In hosted mode, enforce the monthly token cap baked into the tier
 *      price. Cap exceeded → throws CapExceededError, caller renders a
 *      graceful fallback.
 *   3. Lazy-initialise aiProvider + aiUsage on legacy sub-account docs.
 *   4. Provide a `recordUsage` callback the caller invokes after a
 *      successful LLM response so we can increment counters atomically.
 *
 * See docs/ai-provider-billing-spec.md for the full billing design.
 */

const PERIOD_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Tier → cap mapping. Phase 1 reads tier from the agency's
 * subscription price id; null/unknown defaults to Local Pro.
 *
 * Reflects docs/ai-provider-billing-spec.md "Tier allowances".
 */
const TIER_CAPS: Record<string, number> = {
  local_pro: 1_000_000,
  multi_service: 5_000_000,
  territory_partner: 15_000_000,
};
const DEFAULT_CAP = TIER_CAPS.local_pro;

export type ResolvedTier = keyof typeof TIER_CAPS | "unknown";

export class CapExceededError extends Error {
  readonly kind = "cap_exceeded" as const;
  constructor(
    public readonly subAccountId: string,
    public readonly usedTokens: number,
    public readonly capTokens: number,
    public readonly resetsAt: Date,
  ) {
    super(
      `AI usage cap exceeded for sub-account ${subAccountId}: ${usedTokens}/${capTokens} tokens. Resets ${resetsAt.toISOString()}.`,
    );
    this.name = "CapExceededError";
  }
}

export class ByokKeyMissingError extends Error {
  readonly kind = "byok_missing" as const;
  constructor(public readonly subAccountId: string) {
    super(
      `Sub-account ${subAccountId} is in BYOK mode but no OpenRouter key is configured.`,
    );
    this.name = "ByokKeyMissingError";
  }
}

export interface ResolvedAiCallContext {
  /** API key to pass to callAi(). Resolved from BYOK or env. */
  apiKey: string;
  mode: AiProviderMode;
  /**
   * Persist token usage after a successful AI completion. Atomic
   * Firestore FieldValue.increment(). No-op for BYOK mode (the operator
   * owns the cost ceiling so we don't meter their key).
   */
  recordUsage: (totalTokens: number) => Promise<void>;
}

interface SubAccountSlim {
  agencyId: string;
  aiProvider?: {
    mode?: AiProviderMode;
    byokKey?: string | null;
  } | null;
  aiUsage?: {
    currentPeriodTokens?: number;
    currentPeriodStart?: Timestamp | Date;
    monthlyCapTokens?: number;
  } | null;
}

/**
 * Resolve the AI call context for a sub-account. Caller must invoke
 * `recordUsage(totalTokens)` after a successful LLM response.
 *
 * Throws:
 *   - CapExceededError  when hosted mode + over cap
 *   - ByokKeyMissingError when BYOK mode + no key configured
 *   - Error("hosted_key_missing") when hosted mode + OPENROUTER_API_KEY unset
 */
export async function resolveAiCallContext(
  subAccountId: string,
): Promise<ResolvedAiCallContext> {
  const db = getAdminDb();
  const ref = db.doc(`subAccounts/${subAccountId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error(`sub-account ${subAccountId} not found`);
  }
  const data = snap.data() as SubAccountSlim;

  const mode: AiProviderMode = data.aiProvider?.mode ?? "hosted";

  if (mode === "byok") {
    const key = data.aiProvider?.byokKey?.trim();
    if (!key) throw new ByokKeyMissingError(subAccountId);
    return {
      apiKey: key,
      mode,
      // BYOK: operator owns the cost — no metering, no cap enforcement.
      recordUsage: async () => {},
    };
  }

  // Hosted mode — enforce cap + use env key.
  const envKey = process.env.OPENROUTER_API_KEY;
  if (!envKey) {
    throw new Error(
      "hosted_key_missing: OPENROUTER_API_KEY env var not set on this deployment",
    );
  }

  const usage = data.aiUsage ?? {};
  const cap = usage.monthlyCapTokens ?? DEFAULT_CAP;
  const used = usage.currentPeriodTokens ?? 0;
  const periodStart =
    usage.currentPeriodStart instanceof Timestamp
      ? usage.currentPeriodStart.toDate()
      : usage.currentPeriodStart instanceof Date
        ? usage.currentPeriodStart
        : new Date();
  const resetsAt = new Date(periodStart.getTime() + PERIOD_DAYS_MS);

  if (used >= cap) {
    throw new CapExceededError(subAccountId, used, cap, resetsAt);
  }

  return {
    apiKey: envKey,
    mode,
    recordUsage: async (totalTokens: number) => {
      if (totalTokens <= 0) return;
      // Atomic increment + lazy-init of the aiUsage block.
      await ref.set(
        {
          aiUsage: {
            currentPeriodTokens: FieldValue.increment(totalTokens),
            lifetimeTokens: FieldValue.increment(totalTokens),
            currentPeriodStart: usage.currentPeriodStart ?? Timestamp.now(),
            monthlyCapTokens: cap,
          },
        },
        { merge: true },
      );
    },
  };
}

/**
 * Read-only helper — returns the current usage snapshot without bumping
 * anything. Used by the Settings UI + the cap-warning email job.
 */
export async function readAiUsageSnapshot(subAccountId: string): Promise<{
  mode: AiProviderMode;
  currentPeriodTokens: number;
  monthlyCapTokens: number;
  lifetimeTokens: number;
  currentPeriodStart: Date;
  resetsAt: Date;
  byokKeyLast4: string | null;
}> {
  const db = getAdminDb();
  const snap = await db.doc(`subAccounts/${subAccountId}`).get();
  const data = (snap.data() ?? {}) as SubAccountSlim & {
    aiUsage?: { lifetimeTokens?: number };
    aiProvider?: { byokKeyLast4?: string | null };
  };

  const mode: AiProviderMode = data.aiProvider?.mode ?? "hosted";
  const usage = data.aiUsage ?? {};
  const currentPeriodStart =
    usage.currentPeriodStart instanceof Timestamp
      ? usage.currentPeriodStart.toDate()
      : usage.currentPeriodStart instanceof Date
        ? usage.currentPeriodStart
        : new Date();

  return {
    mode,
    currentPeriodTokens: usage.currentPeriodTokens ?? 0,
    monthlyCapTokens: usage.monthlyCapTokens ?? DEFAULT_CAP,
    lifetimeTokens: usage.lifetimeTokens ?? 0,
    currentPeriodStart,
    resetsAt: new Date(currentPeriodStart.getTime() + PERIOD_DAYS_MS),
    byokKeyLast4: data.aiProvider?.byokKeyLast4 ?? null,
  };
}

export { TIER_CAPS, DEFAULT_CAP };
