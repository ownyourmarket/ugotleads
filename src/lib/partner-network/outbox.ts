/**
 * src/lib/partner-network/outbox.ts
 *
 * Server-side (Admin SDK) append-only event outbox for the future MyUSA Partner
 * Network / MLM engine.
 *
 * ── Gating ────────────────────────────────────────────────────────────────────
 * Emission is OFF by default. Set PARTNER_NETWORK_EVENTS_ENABLED=true to start
 * recording events. When off, appendPartnerNetworkEvent() is a no-op that returns
 * { skipped } without any Firestore write — so wiring it into core flows is safe
 * and dormant until intentionally enabled.
 *
 * ── Append-only ───────────────────────────────────────────────────────────────
 * Doc id === idempotencyKey (deterministic). Uses .create(), which throws
 * ALREADY_EXISTS (code 6) on a duplicate — swallowed and reported as { skipped }.
 * Events are never mutated here except (later) status/export metadata by a future
 * exporter. This helper only creates pending events.
 *
 * ── No MLM semantics ──────────────────────────────────────────────────────────
 * Payloads are flat JSON primitives only. No rank/downline/genealogy/team-volume
 * fields. No secrets. No compensation-plan logic.
 */

import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import type {
  PartnerNetworkEventType,
  PartnerNetworkEventPayload,
} from "@/types/partner-network";

const COLLECTION = "partner_network_events";
const SCHEMA_VERSION = 1;

export interface AppendEventInput {
  agencyId: string;
  eventType: PartnerNetworkEventType;
  entityType: string;
  entityId: string;
  payload: PartnerNetworkEventPayload;
  /** ISO 8601 string of when the underlying event occurred. Defaults to now. */
  occurredAtIso?: string | null;
  /** Override the deterministic key. Defaults to `${eventType}_${entityId}`. */
  idempotencyKey?: string;
  source?: string;
}

export type AppendEventResult =
  | { ok: true; eventId: string }
  | { skipped: true; reason: string }
  | { error: true; message: string };

function isEnabled(): boolean {
  return process.env.PARTNER_NETWORK_EVENTS_ENABLED === "true";
}

/**
 * Appends a factual event to the partner_network_events outbox.
 * No-op (returns { skipped }) unless PARTNER_NETWORK_EVENTS_ENABLED=true.
 * Never throws — safe to call best-effort from core flows.
 */
export async function appendPartnerNetworkEvent(
  input: AppendEventInput,
): Promise<AppendEventResult> {
  if (!isEnabled()) {
    return { skipped: true, reason: "PARTNER_NETWORK_EVENTS_ENABLED not set" };
  }
  if (!input.agencyId || !input.entityId) {
    return { error: true, message: "agencyId and entityId are required." };
  }

  // Deterministic, Firestore-safe doc id (no "/").
  const key = (input.idempotencyKey ?? `${input.eventType}_${input.entityId}`).replace(/\//g, "_");

  const db = getAdminDb();
  const ref = db.collection(COLLECTION).doc(key);

  let occurredAt: Timestamp | ReturnType<typeof FieldValue.serverTimestamp>;
  if (input.occurredAtIso) {
    const d = new Date(input.occurredAtIso);
    occurredAt = isNaN(d.getTime()) ? FieldValue.serverTimestamp() : Timestamp.fromDate(d);
  } else {
    occurredAt = FieldValue.serverTimestamp();
  }

  try {
    await ref.create({
      id: key,
      agencyId: input.agencyId,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      occurredAt,
      createdAt: FieldValue.serverTimestamp(),
      source: input.source ?? "ugotleads-core",
      idempotencyKey: key,
      payload: input.payload,
      status: "pending",
      exportAttempts: 0,
      lastExportAttemptAt: null,
      errorMessage: null,
      schemaVersion: SCHEMA_VERSION,
    });
    console.info(`[partner-events] Appended ${input.eventType} → partner_network_events/${key}`);
    return { ok: true, eventId: key };
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 6) {
      // ALREADY_EXISTS — duplicate emission; append-only, swallow.
      return { skipped: true, reason: `Duplicate event ${key}` };
    }
    const message = err instanceof Error ? err.message : "Outbox write failed.";
    console.error(`[partner-events] Failed to append ${input.eventType} (${key}):`, err);
    return { error: true, message };
  }
}
