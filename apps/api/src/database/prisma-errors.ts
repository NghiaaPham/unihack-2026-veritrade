/** Prisma's error code for a violated unique constraint. */
const PRISMA_UNIQUE_CONSTRAINT = 'P2002';
/** Postgres SQLSTATE for `unique_violation`, seen when a raw query fails. */
const POSTGRES_UNIQUE_VIOLATION = '23505';

/**
 * Did this error come from a unique constraint?
 *
 * Two shapes have to be recognised: Prisma surfaces `P2002` on its own
 * `PrismaClientKnownRequestError`, while a raw query can leak the driver's
 * SQLSTATE straight through. Matching on the code rather than on the error
 * class keeps this working even if two copies of the generated client end up
 * loaded, which would break an `instanceof` check.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  const { code } = error as { code?: unknown };

  return code === PRISMA_UNIQUE_CONSTRAINT || code === POSTGRES_UNIQUE_VIOLATION;
}
