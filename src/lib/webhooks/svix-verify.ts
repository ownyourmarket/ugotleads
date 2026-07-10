import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Manual verification of Svix-style webhook signatures (used by Resend).
 * Signed content is `${id}.${timestamp}.${body}` HMAC-SHA256'd with the
 * base64-decoded portion of the `whsec_…` secret; the header carries one
 * or more space-separated `v1,<base64sig>` entries. No svix dependency.
 */
export function verifySvixSignature(input: {
  secret: string;
  id: string;
  timestamp: string;
  signature: string;
  body: string;
  toleranceSeconds?: number;
}): boolean {
  const tolerance = input.toleranceSeconds ?? 300;
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > tolerance) return false;

  const secretB64 = input.secret.startsWith("whsec_")
    ? input.secret.slice("whsec_".length)
    : input.secret;
  let key: Buffer;
  try {
    key = Buffer.from(secretB64, "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const expected = createHmac("sha256", key)
    .update(`${input.id}.${input.timestamp}.${input.body}`)
    .digest();

  for (const part of input.signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    ) {
      return true;
    }
  }
  return false;
}
