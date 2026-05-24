import { NextResponse } from "next/server";
import { LANDING_VARIANT } from "@/config/landing";
import { recordClick } from "@/lib/affiliate/clicks";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function ipFromRequest(request: Request): string | null {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip");
}

/**
 * Anonymous beacon fired by <RefTracker /> when a visitor lands with a
 * ?ref= param. Server-side write means the visitor can't tamper with the
 * outcome (e.g. by inflating their own click count).
 *
 * Best-effort: returns 200 even on internal failures so the client never
 * sees an error or retries. The dashboard tolerates missing clicks better
 * than it tolerates retry storms.
 */
export async function POST(request: Request) {
  if (LANDING_VARIANT !== "leadstack") {
    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  }

  let body: { code?: string; landingPath?: string; referrer?: string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  }

  const code = (body.code ?? "").trim();
  if (!code) {
    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  }

  try {
    await recordClick({
      code,
      ip: ipFromRequest(request),
      userAgent: request.headers.get("user-agent"),
      landingPath: (body.landingPath ?? "/").slice(0, 500),
      referrer: body.referrer ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[affiliate/track] ${message}`);
  }

  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}
