import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySvixSignature } from "@/lib/webhooks/svix-verify";

function sign(secretB64: string, id: string, ts: string, body: string): string {
  return createHmac("sha256", Buffer.from(secretB64, "base64"))
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
}

describe("verifySvixSignature", () => {
  const secretB64 = randomBytes(24).toString("base64");
  const secret = `whsec_${secretB64}`;
  const id = "msg_abc";
  const body = '{"type":"email.received"}';

  it("accepts a valid v1 signature within tolerance", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v1,${sign(secretB64, id, ts, body)}`;
    expect(
      verifySvixSignature({ secret, id, timestamp: ts, signature: sig, body })
    ).toBe(true);
  });

  it("accepts when a valid sig is one of several space-separated entries", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v1,${Buffer.from("garbage").toString("base64")} v1,${sign(secretB64, id, ts, body)}`;
    expect(
      verifySvixSignature({ secret, id, timestamp: ts, signature: sig, body })
    ).toBe(true);
  });

  it("rejects wrong secret, tampered body, and stale timestamp", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v1,${sign(secretB64, id, ts, body)}`;
    expect(
      verifySvixSignature({
        secret: "whsec_" + randomBytes(24).toString("base64"),
        id,
        timestamp: ts,
        signature: sig,
        body,
      })
    ).toBe(false);
    expect(
      verifySvixSignature({
        secret,
        id,
        timestamp: ts,
        signature: sig,
        body: body + " ",
      })
    ).toBe(false);
    const staleTs = String(Math.floor(Date.now() / 1000) - 3600);
    const staleSig = `v1,${sign(secretB64, id, staleTs, body)}`;
    expect(
      verifySvixSignature({
        secret,
        id,
        timestamp: staleTs,
        signature: staleSig,
        body,
      })
    ).toBe(false);
  });
});
