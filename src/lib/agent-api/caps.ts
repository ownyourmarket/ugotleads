import "server-only";

import type { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { agentError } from "@/lib/agent-api/errors";

class CapExceededError extends Error {}

/**
 * Transactionally count one unit against the key's daily cap.
 * Returns null when under the cap (and the unit is counted), or a
 * ready-to-return 429 NextResponse when the cap is reached.
 * Counter doc: agencyServiceKeys/{keyId}/usage/{YYYY-MM-DD} (UTC).
 */
export async function enforceDailyCap(
  keyId: string,
  cap: "sends",
  limit: number,
): Promise<NextResponse | null> {
  const db = getAdminDb();
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`agencyServiceKeys/${keyId}/usage/${day}`);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? ((snap.data()?.[cap] as number) ?? 0) : 0;
      if (current >= limit) throw new CapExceededError();
      tx.set(ref, { [cap]: current + 1 }, { merge: true });
    });
    return null;
  } catch (err) {
    if (err instanceof CapExceededError) {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setUTCHours(24, 0, 0, 0);
      const retryAfter = Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 1000));
      return agentError(
        "CAP_EXCEEDED",
        `Daily ${cap} cap of ${limit} reached for this key.`,
        429,
        { limit },
        { "Retry-After": String(retryAfter) },
      );
    }
    throw err;
  }
}
