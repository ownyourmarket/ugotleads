import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

export type AgentHandlerResult = { status: number; body: unknown };

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Replay-safe wrapper for mutating agent routes. If the caller sends an
 * Idempotency-Key header and we already stored a response for it (within
 * 24h), replay the stored response instead of re-running the handler.
 *
 * Known small race: two truly concurrent requests with the same fresh key
 * can both run the handler (get-then-set, no transaction). Acceptable for
 * v1 — the caller is a single orchestrator, not a fleet.
 */
export async function withIdempotency(
  request: Request,
  keyId: string,
  scope: string,
  handler: () => Promise<AgentHandlerResult>,
  opts?: { preflight?: () => Promise<NextResponse | null> }
): Promise<NextResponse> {
  const idemKey = request.headers.get("idempotency-key");
  if (!idemKey) {
    if (opts?.preflight) {
      const blocked = await opts.preflight();
      if (blocked) return blocked;
    }
    const r = await handler();
    return NextResponse.json(r.body, { status: r.status });
  }

  const db = getAdminDb();
  const docId = `${keyId}_${createHash("sha256").update(`${scope}\n${idemKey}`).digest("hex").slice(0, 32)}`;
  const ref = db.doc(`agentIdempotency/${docId}`);

  const snap = await ref.get();
  if (snap.exists) {
    const saved = snap.data() as {
      status: number;
      body: unknown;
      expiresAtMs: number;
    };
    if (saved.expiresAtMs > Date.now()) {
      return NextResponse.json(saved.body, {
        status: saved.status,
        headers: { "x-idempotent-replay": "true" },
      });
    }
  }

  // Replay missed (fresh key or expired entry): run the preflight check
  // (e.g. daily cap) before the handler. A blocked preflight is never
  // cached — it must remain retryable once capacity frees up.
  if (opts?.preflight) {
    const blocked = await opts.preflight();
    if (blocked) return blocked;
  }

  const r = await handler();
  // Only cache definitive outcomes; a 5xx should be retryable.
  if (r.status < 500) {
    await ref.set({
      status: r.status,
      body: r.body,
      expiresAtMs: Date.now() + TTL_MS,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return NextResponse.json(r.body, { status: r.status });
}
