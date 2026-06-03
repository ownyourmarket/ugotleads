// src/types/partner-network.ts
import type { Timestamp, FieldValue } from "firebase/firestore";

/**
 * Append-only event outbox feeding the FUTURE MyUSA Partner Network / MLM engine.
 *
 * These events are factual, past-tense records of things that already happened
 * in uGotLeads core. They carry NO MLM semantics — no rank, level, upline,
 * downline, genealogy, or team volume. The (future, external) MLM engine derives
 * all of that itself from these facts.
 *
 * Collection: partner_network_events/{idempotencyKey}
 *
 * ── Write access ──────────────────────────────────────────────────────────────
 * Server-only (Admin SDK), append-only. Written by appendPartnerNetworkEvent().
 * Emission is gated by PARTNER_NETWORK_EVENTS_ENABLED (default off) so the
 * outbox stays dormant until intentionally enabled. No consumer/exporter exists
 * yet — this phase only records events.
 *
 * Clients: agency owner READ-only (gated by Firestore rules). No client writes.
 */

export type PartnerNetworkEventType =
  | "partner.created"
  | "partner.certified"
  | "product.purchased"
  | "marketplace.purchase.paid"
  | "entitlement.granted"
  | "commission.event.created"
  | "commission.event.paid"
  | "refund.created"
  | "chargeback.created"
  | "subscription.renewed"
  | "subscription.canceled"
  | "credit.purchase.created";

export type PartnerNetworkEventStatus = "pending" | "exported" | "ignored" | "failed";

/**
 * A payload may only contain JSON-serializable primitives. No nested objects,
 * no MLM structures (rank/downline/genealogy), no secrets.
 */
export type PartnerNetworkEventPayload = Record<string, string | number | boolean | null>;

export interface PartnerNetworkEvent {
  id: string;                       // === idempotencyKey
  agencyId: string;
  eventType: PartnerNetworkEventType;
  /** Core entity kind, e.g. "marketplace_purchase" | "product_entitlement" | "commission_event". */
  entityType: string;
  /** Core entity id (session id, entitlement id, commission event id, etc.). */
  entityId: string;
  /** When the underlying core event happened. */
  occurredAt: Timestamp | FieldValue | null;
  createdAt: Timestamp | FieldValue | null;
  /** Always "ugotleads-core" for events emitted by this app. */
  source: string;
  idempotencyKey: string;
  payload: PartnerNetworkEventPayload;
  /** Export lifecycle. pending until a future exporter processes it. */
  status: PartnerNetworkEventStatus;
  exportAttempts: number;
  lastExportAttemptAt: Timestamp | FieldValue | null;
  errorMessage: string | null;
  schemaVersion: number;
}
