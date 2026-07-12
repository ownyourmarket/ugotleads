/**
 * API routes that self-authenticate via an Authorization: Bearer <Firebase ID token>
 * fallback (see require-tenancy.ts). On a missing/invalid session cookie the
 * middleware must NOT 302-redirect these to /login — let the route run and
 * 401 itself if the bearer is bad.
 * These stay behind auth; they are NOT added to PUBLIC_PATHS (the cookie path
 * still works).
 *
 * Extracted to a standalone, dependency-free module (no next/server, no
 * next-firebase-auth-edge) so it can be unit-tested without pulling in the
 * full middleware import graph.
 */
export const BEARER_API_PATTERNS: RegExp[] = [
  /^\/api\/sub-accounts\/[^/]+\/promptexpert\/run$/,
  /^\/api\/sub-accounts\/[^/]+\/promptexpert\/gpts\/[^/]+\/chat$/,
];

export function isBearerApiPath(pathname: string): boolean {
  return BEARER_API_PATTERNS.some((re) => re.test(pathname));
}
