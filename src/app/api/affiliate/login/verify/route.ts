import { NextResponse } from "next/server";
import { LANDING_VARIANT } from "@/config/landing";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  signSessionToken,
  verifyMagicLinkToken,
} from "@/lib/affiliate/magic-link";
import { setAffiliateSessionCookie } from "@/lib/affiliate/session";

export const dynamic = "force-dynamic";

/**
 * Verifies a magic-link token from the sign-in email and exchanges it for
 * a 30-day session cookie. Redirects to the dashboard on success or back
 * to /affiliate/login with an error param on failure.
 *
 * GET so the email link works on a single tap.
 */
export async function GET(request: Request) {
  if (LANDING_VARIANT !== "leadstack") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/affiliate/login?error=missing_token", url));
  }

  const verified = verifyMagicLinkToken(token);
  if (!verified) {
    return NextResponse.redirect(new URL("/affiliate/login?error=expired", url));
  }

  // Confirm the affiliate doc still exists + is active. Lets the operator
  // revoke access by flipping `status` to "paused" or "banned".
  const snap = await getAdminDb()
    .collection("affiliates")
    .doc(verified.affiliateId)
    .get();
  if (!snap.exists) {
    return NextResponse.redirect(new URL("/affiliate/login?error=not_found", url));
  }
  const data = snap.data() as { status?: string; email?: string };
  if (data.status !== "active") {
    return NextResponse.redirect(new URL("/affiliate/login?error=inactive", url));
  }

  const sessionToken = signSessionToken(
    verified.affiliateId,
    data.email ?? verified.email,
  );
  await setAffiliateSessionCookie(sessionToken);

  return NextResponse.redirect(new URL("/affiliate/dashboard", url));
}
