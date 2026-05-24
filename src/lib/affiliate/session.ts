import "server-only";

import { cookies } from "next/headers";
import {
  AFFILIATE_SESSION_COOKIE,
  AFFILIATE_SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from "@/lib/affiliate/magic-link";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Affiliate } from "@/types/affiliate";

/**
 * Reads the affiliate session cookie, verifies the HMAC signature, and
 * loads the current affiliate doc. Returns null when the cookie is missing,
 * invalid, expired, or the affiliate no longer exists / is inactive.
 *
 * Server-only — called from server components (dashboard pages) and route
 * handlers (logout, dashboard data fetches).
 */
export async function getCurrentAffiliate(): Promise<Affiliate | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AFFILIATE_SESSION_COOKIE)?.value;
  if (!token) return null;

  const verified = verifySessionToken(token);
  if (!verified) return null;

  const snap = await getAdminDb()
    .collection("affiliates")
    .doc(verified.affiliateId)
    .get();
  if (!snap.exists) return null;

  const data = snap.data() as Omit<Affiliate, "id">;
  if (data.status !== "active") return null;

  return { id: snap.id, ...data };
}

export async function setAffiliateSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(AFFILIATE_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AFFILIATE_SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearAffiliateSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(AFFILIATE_SESSION_COOKIE);
}
