import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authMiddleware } from "next-firebase-auth-edge/lib/next/middleware";

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/promptexpert",
  "/signup",
  "/terms",
  "/privacy",
  "/thank-you",
  "/f",
  "/api/forms",
  "/api/auth/signup",
  "/api/automations/step",
  "/api/broadcasts/email/step",
  "/api/social-content/generate-step",
  "/api/cron/ai-usage-reset",
  "/api/checkout/public-subscription",
  "/api/webhooks/zernio",
  "/api/checkout",
  "/api/cron/gitpage-heartbeat",
  "/api/landing/metrics",
  "/api/webhooks/twilio",
  // Resend inbound email webhook — signature-verified inside the route
  // (Task 8 svix verify), not session auth. Needs its own entry (no
  // sub-path) since it has no trailing segments to prefix-match on.
  "/api/webhooks/resend-inbound",
  "/api/webhooks/stripe",
  // Web Chat widget — public from-the-browser API. Security:
  //  - Origin header validated against per-sub-account allowedDomains
  //  - In-memory per-IP + per-session rate limits
  //  - Anonymous sessions; identity only captured via [[capture …]] marker
  "/api/web-chat",
  // Embed pages — the chat widget iframe target. Public; the bot
  // can't send messages without passing the /api/web-chat/* origin check.
  "/embed",
  // Widget loader JS — public static file served from /public.
  "/widget.js",
  "/api/track",
  "/u",
  "/api/u",
  "/api/dev-only/danger-wipe-everything",
  "/setup.html",
  // Affiliate program — own session model (magic-link HMAC cookie), not
  // Firebase Auth. Auth checks happen inside each route/page.
  "/affiliate",
  "/api/affiliate",
  // Agent API — machine callers with service keys. Session middleware is
  // bypassed; every route authenticates itself via requireServiceAuth().
  "/api/agent",
];

/**
 * Dynamic public paths — patterns that contain a path param. These are
 * QStash-callback / webhook endpoints whose security comes from signature
 * verification inside the route, not from session auth.
 */
const PUBLIC_PATH_PATTERNS: RegExp[] = [
  // gitpage build poll: /api/sub-accounts/{id}/website/poll
  /^\/api\/sub-accounts\/[^/]+\/website\/poll$/,
];

function isPublicPath(pathname: string): boolean {
  if (
    PUBLIC_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`)
    )
  ) {
    return true;
  }
  return PUBLIC_PATH_PATTERNS.some((re) => re.test(pathname));
}

/**
 * API routes that self-authenticate via an Authorization: Bearer <Firebase ID token>
 * fallback (see require-tenancy.ts). On a missing/invalid session cookie we must NOT
 * 302-redirect these to /login — let the route run and 401 itself if the bearer is bad.
 * These stay behind auth; they are NOT added to PUBLIC_PATHS (the cookie path still works).
 */
const BEARER_API_PATTERNS: RegExp[] = [
  /^\/api\/sub-accounts\/[^/]+\/promptexpert\/run$/,
  /^\/api\/sub-accounts\/[^/]+\/promptexpert\/gpts\/[^/]+\/chat$/,
];
function isBearerApiPath(pathname: string): boolean {
  return BEARER_API_PATTERNS.some((re) => re.test(pathname));
}

/**
 * Strip any client-supplied identity headers so a spoofed `x-user-uid` can never
 * reach a route. Only the middleware's cookie-verified handleValidToken may set them.
 */
function passthroughWithStrippedIdentity(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete("x-user-uid");
  headers.delete("x-user-email");
  return NextResponse.next({ request: { headers } });
}

export default function middleware(request: NextRequest) {
  // Skip auth middleware if Firebase is not configured
  if (
    !process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
    !process.env.FIREBASE_ADMIN_PROJECT_ID
  ) {
    return NextResponse.next();
  }

  return authMiddleware(request, {
    loginPath: "/api/login",
    logoutPath: "/api/logout",
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    cookieName: "__session",
    cookieSignatureKeys: [
      process.env.COOKIE_SECRET_CURRENT ?? "",
      process.env.COOKIE_SECRET_PREVIOUS ?? "",
    ],
    cookieSerializeOptions: {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 12 * 60 * 60 * 24, // 12 days
    },
    serviceAccount: {
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID ?? "",
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL ?? "",
      privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "").replace(
        /\\n/g,
        "\n"
      ),
    },
    handleValidToken: async ({ decodedToken }, headers) => {
      // Allow authenticated users through
      // Attach user info to headers for downstream use
      headers.set("x-user-uid", decodedToken.uid);
      headers.set("x-user-email", decodedToken.email ?? "");

      return NextResponse.next({ request: { headers } });
    },
    handleInvalidToken: async () => {
      const pathname = request.nextUrl.pathname;

      // Allow public paths without authentication
      if (isPublicPath(pathname)) {
        return NextResponse.next();
      }

      if (isBearerApiPath(pathname)) {
        return passthroughWithStrippedIdentity(request); // strip forged headers; route verifies the bearer itself
      }

      // Redirect unauthenticated users to login for protected paths
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirect", pathname);
      return NextResponse.redirect(url);
    },
    handleError: async () => {
      const pathname = request.nextUrl.pathname;

      // On error, allow public paths and redirect protected paths
      if (isPublicPath(pathname)) {
        return NextResponse.next();
      }

      if (isBearerApiPath(pathname)) {
        return passthroughWithStrippedIdentity(request); // strip forged headers; route verifies the bearer itself
      }

      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirect", pathname);
      return NextResponse.redirect(url);
    },
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    "/api/login",
    "/api/logout",
    // Image-extension exclusion above would otherwise let a path like
    // /api/agency/service-keys/foo.png skip middleware entirely. All /api
    // routes must always run through middleware.
    "/api/:path*",
  ],
};
