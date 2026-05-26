import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

/**
 * BYOK key encryption — symmetric AES-256-GCM at rest.
 *
 * Operator-provided OpenRouter keys live in Firestore. v1 stored them
 * plaintext; this module wraps them with AES-256-GCM authenticated
 * encryption using a deployment-wide secret in BYOK_ENCRYPTION_KEY.
 *
 * Threat model addressed:
 *   - Firestore export / unauthorized DB read: keys are useless without
 *     BYOK_ENCRYPTION_KEY, which lives only in Vercel env.
 *   - Backup leaks: same.
 *
 * NOT addressed (out of scope for v1):
 *   - Runtime memory dumps (key is decrypted in-process before each call).
 *   - Compromise of Vercel env vars (rotate BYOK_ENCRYPTION_KEY and all
 *     stored BYOK keys become unusable — by design).
 *
 * Storage format: `v1:${ivBase64}:${authTagBase64}:${ciphertextBase64}`
 * The `v1:` prefix lets us migrate the format later without breaking
 * existing keys.
 *
 * Rotation: if BYOK_ENCRYPTION_KEY needs to be rotated, all stored BYOK
 * keys become unreadable. Operators must re-enter them. Document this
 * in the runbook before rotating.
 */

const FORMAT_VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard

function deriveKey(): Buffer {
  const secret = process.env.BYOK_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "BYOK_ENCRYPTION_KEY not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  // Derive a fixed 32-byte key from the secret. Using SHA-256 lets us
  // tolerate either a 32-byte raw key OR a base64-encoded one OR an
  // arbitrary-length passphrase without changing the cipher input shape.
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Returns the format-prefixed ciphertext string safe to persist. */
export function encryptByokKey(plaintext: string): string {
  if (!plaintext) throw new Error("Cannot encrypt empty plaintext");
  const key = deriveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${FORMAT_VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/**
 * Decrypts a previously-encrypted BYOK key. Tolerates legacy plaintext
 * values (no `v1:` prefix) so the migration is zero-downtime: existing
 * plaintext keys keep working until the operator next saves the field,
 * at which point we encrypt going forward.
 */
export function decryptByokKey(stored: string): string {
  if (!stored) throw new Error("Cannot decrypt empty stored value");
  if (!stored.startsWith(`${FORMAT_VERSION}:`)) {
    // Legacy plaintext — return as-is so it still works.
    return stored;
  }
  const parts = stored.split(":");
  if (parts.length !== 4) {
    throw new Error("Malformed encrypted BYOK key");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const key = deriveKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Helper: returns true if the stored value is in the encrypted format.
 * Used by the migration path to know whether to re-wrap.
 */
export function isEncrypted(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(`${FORMAT_VERSION}:`);
}

/** True iff BYOK_ENCRYPTION_KEY is set. UI uses this to surface a setup
 *  warning when the operator tries to switch to BYOK on a deployment
 *  that hasn't configured encryption yet. */
export function byokEncryptionConfigured(): boolean {
  return !!process.env.BYOK_ENCRYPTION_KEY;
}
