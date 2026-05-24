import { NextResponse } from "next/server";
import { LANDING_VARIANT } from "@/config/landing";
import { clearAffiliateSessionCookie } from "@/lib/affiliate/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (LANDING_VARIANT !== "leadstack") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await clearAffiliateSessionCookie();
  return NextResponse.redirect(new URL("/affiliate/login", request.url));
}
