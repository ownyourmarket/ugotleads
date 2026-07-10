import { createHash, randomBytes } from "node:crypto";

export function hashServiceKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateServiceKey(): {
  key: string;
  keyHash: string;
  keyPrefix: string;
} {
  const key = `ugl_${randomBytes(20).toString("hex")}`;
  return { key, keyHash: hashServiceKey(key), keyPrefix: key.slice(0, 8) };
}
