import type { MembershipRole } from '../generated/prisma/client.js';

/**
 * What the request is allowed to act on, resolved per request.
 *
 * This is never taken from a header or a body — it is derived from a verified
 * token plus a live membership lookup, so revoking a membership takes effect on
 * the next request rather than when the token expires.
 */
export interface AuthContext {
  userId: string;
  email: string;
  displayName: string;
  organizationId: string;
  organizationSlug: string;
  role: MembershipRole;
}

/** Claims carried in the access token. Deliberately minimal. */
export interface JwtPayload {
  /** User id. */
  sub: string;
  /** Organization id the token was issued for. */
  org: string;
  /** Role at issue time — informational only; the guard re-reads the live row. */
  role: MembershipRole;
}
