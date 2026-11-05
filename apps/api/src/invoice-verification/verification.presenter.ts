import type { InvoiceVerification, VerificationCheck } from '../generated/prisma/client.js';

/**
 * Verification responses.
 *
 * `scope` is a literal, not a database column: every verdict this service
 * produces today comes from local checks alone, and putting it in the payload
 * on every response is what stops a client from reading `status: 'PASSED'` as
 * a statement that the tax authority approved the invoice.
 */

export interface VerificationCheckResponse {
  key: string;
  label: string;
  status: VerificationCheck['status'];
  message: string;
  details: Record<string, unknown> | null;
  durationMs: number;
}

export interface VerificationResponse {
  id: string;
  status: InvoiceVerification['status'];
  scope: 'LOCAL_CHECKS_ONLY';
  provider: string;
  /** Null on purpose: no scoring model exists, and 0 or 100 would be a claim. */
  score: number | null;
  checkedAt: string | null;
  createdAt: string;
  limitations: string[];
  checks: VerificationCheckResponse[];
}

/**
 * Reads `limitations` back out of the stored `findings` blob.
 *
 * Stored rather than recomputed so an old run keeps the wording it was
 * recorded with, even after a check's message changes.
 */
export function limitationsOf(findings: unknown): string[] {
  if (typeof findings !== 'object' || findings === null) {
    return [];
  }

  const { limitations } = findings as { limitations?: unknown };

  if (!Array.isArray(limitations)) {
    return [];
  }

  return limitations.filter((entry): entry is string => typeof entry === 'string');
}

export function toVerificationResponse(
  verification: InvoiceVerification & { checks: VerificationCheck[] },
  labels: ReadonlyMap<string, string>,
): VerificationResponse {
  return {
    id: verification.id,
    status: verification.status,
    scope: 'LOCAL_CHECKS_ONLY',
    provider: verification.provider,
    score: verification.score,
    checkedAt: verification.verifiedAt === null ? null : verification.verifiedAt.toISOString(),
    createdAt: verification.createdAt.toISOString(),
    limitations: limitationsOf(verification.findings),
    checks: verification.checks.map((check) => ({
      key: check.key,
      label: labels.get(check.key) ?? check.key,
      status: check.status,
      message: check.message,
      details: (check.details ?? null) as Record<string, unknown> | null,
      durationMs: check.durationMs,
    })),
  };
}
