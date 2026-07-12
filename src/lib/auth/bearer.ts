export function parseBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const m = /^Bearer (\S+)$/i.exec(authorizationHeader.trim());
  return m ? m[1] : null;
}
