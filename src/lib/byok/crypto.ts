/**
 * src/lib/byok/crypto.ts
 *
 * AES-256-GCM encryption for BYOK partner API keys.
 *
 * ── Why AES-256-GCM ─────────────────────────────────────────────────────────
 * GCM (Galois/Counter Mode) provides both confidentiality and authenticity
 * via the auth tag. Any tampering with the ciphertext or the stored metadata
 * causes decryption to throw, preventing silent data corruption.
 *
 * ── Env var ─────────────────────────────────────────────────────────────────
 * BYOK_KEY_ENCRYPTION_SECRET — master secret used to derive the AES key.
 * Generate with: openssl rand -hex 32
 * This produces 256 bits of random entropy which SHA-256 passes through as-is
 * (any 64-char hex string is already 32 bytes; SHA-256 just normalizes length
 * for shorter or non-hex inputs).
 *
 * ── Stored fields ────────────────────────────────────────────────────────────
 * encryptedKey  — hex-encoded AES-256-GCM ciphertext
 * iv            — hex-encoded 96-bit (12-byte) initialization vector
 * authTag       — hex-encoded 128-bit (16-byte) GCM authentication tag
 *
 * Each encryption uses a fresh random IV so two encryptions of the same
 * plaintext produce different ciphertexts.
 *
 * ── Not yet wired ────────────────────────────────────────────────────────────
 * decryptByokKey is exported for future use but not called by any live path.
 * Phase 17 only secures storage. Actual key retrieval is Phase 18+.
 *
 * ── No MLM / compensation plan logic ─────────────────────────────────────
 * This file only handles symmetric encryption of API key strings.
 */

import "server-only";

import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SealedByokKey {
  /** AES-256-GCM ciphertext, hex-encoded. */
  encryptedKey: string;
  /** 12-byte initialization vector, hex-encoded (24 hex chars). */
  iv: string;
  /** 16-byte GCM authentication tag, hex-encoded (32 hex chars). */
  authTag: string;
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/**
 * Derives a 32-byte AES-256 key from BYOK_KEY_ENCRYPTION_SECRET.
 *
 * SHA-256 normalizes any string to exactly 32 bytes.
 * When the env var is generated with `openssl rand -hex 32` (recommended),
 * SHA-256 passes the entropy through unchanged.
 *
 * Throws a configuration error if the env var is not set.
 */
function getAesKey(): Buffer {
  const secret = process.env.BYOK_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "BYOK_KEY_ENCRYPTION_SECRET is not configured. " +
      "Generate one with: openssl rand -hex 32",
    );
  }
  // SHA-256 normalizes any string to 32 bytes.
  // High-entropy secrets (e.g. openssl rand -hex 32) pass through unchanged.
  return createHash("sha256").update(secret, "utf8").digest();
}

// ---------------------------------------------------------------------------
// Encrypt
// ---------------------------------------------------------------------------

/**
 * Encrypts a BYOK API key using AES-256-GCM.
 *
 * Each call generates a fresh random IV so repeated calls on the same
 * plaintext produce different ciphertexts. The auth tag ensures the
 * ciphertext cannot be tampered with silently.
 *
 * Throws if BYOK_KEY_ENCRYPTION_SECRET is not set.
 */
export function encryptByokKey(plainText: string): SealedByokKey {
  const key = getAesKey();
  const iv = randomBytes(12);  // 96-bit IV — recommended length for AES-GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag(); // 128-bit tag by default

  return {
    encryptedKey: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

// ---------------------------------------------------------------------------
// Decrypt
// ---------------------------------------------------------------------------

/**
 * Decrypts a sealed BYOK key.
 *
 * Throws if:
 *   - BYOK_KEY_ENCRYPTION_SECRET is not set
 *   - The auth tag does not match (wrong key or tampered ciphertext)
 *   - The hex strings are malformed
 *
 * Not yet called by any live path (Phase 17 secures storage only).
 * Will be used in Phase 18+ when BYOK products need the actual key at runtime.
 */
export function decryptByokKey(sealed: SealedByokKey): string {
  const key = getAesKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(sealed.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(sealed.authTag, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(sealed.encryptedKey, "hex")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
