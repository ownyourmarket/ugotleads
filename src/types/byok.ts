// src/types/byok.ts
import type { Timestamp, FieldValue } from "firebase/firestore";

/**
 * Server-only record of a partner's BYOK API key for a specific product.
 *
 * Doc id: `${partnerProfileId}_${productId}`
 * Collection: byok_keys/{id}
 *
 * ── Security ────────────────────────────────────────────────────────────────
 * This collection is UNREADABLE from the client SDK. All reads and writes go
 * through the Admin SDK (API routes only). The `apiKey` field is NEVER returned
 * in any API response or logged to any output stream accessible to clients.
 *
 * Safe display fields (last4, validatedAt, byokConfigured) are maintained on
 * the partner's `product_eligibility` doc, which is client-readable.
 *
 * ── Key lifecycle ────────────────────────────────────────────────────────────
 * SET:   apiKey = full key, clearedAt = null
 * CLEAR: apiKey = null, clearedAt = serverTimestamp()
 *
 * Docs are never deleted — clearedAt serves as the tombstone. This preserves
 * the audit trail (timestamps, provider, last4) after a key is removed.
 */
export interface ByokKey {
  id: string;                         // `${partnerProfileId}_${productId}`
  agencyId: string;
  partnerProfileId: string;
  productId: string;
  /**
   * Third-party provider identifier. Null in Phase 17 (not yet used for routing).
   * Future values: "openai" | "google" | "anthropic" | "custom"
   */
  provider: string | null;
  /**
   * AES-256-GCM ciphertext of the partner's API key, hex-encoded.
   * Null when cleared. Decrypted server-side via lib/byok/crypto.ts using
   * BYOK_KEY_ENCRYPTION_SECRET. NEVER returned to clients.
   */
  encryptedKey: string | null;
  /**
   * AES-256-GCM initialization vector, hex-encoded (24 hex chars = 12 bytes).
   * Null when cleared.
   */
  iv: string | null;
  /**
   * AES-256-GCM authentication tag, hex-encoded (32 hex chars = 16 bytes).
   * Required for decryption integrity check. Null when cleared.
   */
  authTag: string | null;
  /**
   * Last 4 characters of the plaintext key — safe to mirror on the eligibility
   * doc and display in the partner UI for identification.
   */
  keyLast4: string | null;
  validatedAt: Timestamp | FieldValue | null;
  /** Timestamp when the key was intentionally removed by the partner. */
  clearedAt: Timestamp | FieldValue | null;
  createdAt: Timestamp | FieldValue | null;
  updatedAt: Timestamp | FieldValue | null;
}
