import type {
  Invoice,
  InvoiceDocument,
  VerificationCheckStatus,
} from '../../generated/prisma/client.js';
import type { ParsedInvoice } from '../../invoices/xml/invoice-xml.types.js';

/**
 * Everything a check is allowed to look at.
 *
 * Checks receive the *persisted* record rather than the freshly parsed document
 * on purpose: the invoice row is what financing decisions will read, so it is
 * what has to be verified. `parsed` is supplied as well because some checks
 * (line-item arithmetic) need detail that is not stored.
 */
export interface VerificationInput {
  invoice: Invoice;
  document: InvoiceDocument | null;
  /** Raw document bytes, or null for invoices created from structured metadata. */
  xml: Buffer | null;
  /** Result of parsing `xml`, or null when parsing was not attempted or failed. */
  parsed: ParsedInvoice | null;
  /** Set when the document could not be parsed. */
  parseError: { code: string; message: string } | null;
  organizationId: string;
}

export interface CheckOutcome {
  status: VerificationCheckStatus;
  /** Short, human-readable, and never containing document contents. */
  message: string;
  /** Structured evidence: counts, expected vs actual, algorithm names. */
  details?: Record<string, unknown>;
}

/**
 * One independent verification step.
 *
 * Checks are independent by contract: each receives the same input and returns
 * its own verdict, so a failure in one cannot mask or manufacture a pass in
 * another. The engine runs them all and aggregates.
 */
export interface VerificationCheck {
  /** Stable machine key. Clients branch on this, so it must not change. */
  readonly key: string;
  readonly label: string;
  run(input: VerificationInput): Promise<CheckOutcome>;
}

/**
 * The canonical check keys, in execution order.
 *
 * Exported so tests and docs reference the same strings the engine writes to
 * the database, rather than a parallel copy that can drift.
 */
export const CHECK_KEYS = {
  xmlStructure: 'xml.structure',
  requiredFields: 'fields.required',
  arithmetic: 'arithmetic.totals',
  duplicate: 'duplicate.detection',
  signature: 'signature.xmldsig',
  signatureTrust: 'signature.trust',
  taxAuthority: 'authority.tax',
} as const;
