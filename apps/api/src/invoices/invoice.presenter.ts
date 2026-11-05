import type { Invoice, InvoiceDocument } from '../generated/prisma/client.js';
import type { VerificationResponse } from '../invoice-verification/verification.presenter.js';

/**
 * Invoice API representations.
 *
 * Two rules are applied everywhere below:
 *
 *   1. **Money leaves as a string.** `Decimal` serialises to a JSON string on
 *      its own, but relying on that means the contract is defined by a
 *      library's `toJSON`. A client parsing it into a float would silently
 *      lose precision on a 38-digit value, so the type is stated explicitly.
 *   2. **Dates are split by meaning.** A calendar date (`issueDate`) is
 *      `YYYY-MM-DD`; an instant (`createdAt`) is a full ISO-8601 timestamp.
 *      Returning `2026-09-01T00:00:00.000Z` for an issue date implies a
 *      midnight-UTC event that never happened.
 */

export interface DocumentResponse {
  filename: string;
  mimeType: string;
  byteSize: number;
  /** SHA-256 of the raw bytes. The storage key is derived from it. */
  contentSha256: string;
  format: string;
  parserVersion: string;
  createdAt: string;
}

export interface InvoiceResponse {
  id: string;
  organizationId: string;
  status: Invoice['status'];
  invoiceSeries: string;
  invoiceNumber: string;
  invoiceType: string;
  invoiceTypeName: string | null;
  sellerName: string;
  sellerTaxId: string;
  buyerName: string;
  buyerTaxId: string;
  currency: string;
  amount: string;
  subtotalAmount: string | null;
  taxAmount: string | null;
  issueDate: string;
  dueDate: string | null;
  /** SHA-256 over the canonical identity tuple. */
  fingerprint: string;
  /** SHA-256 over the normalised business content. */
  contentHash: string;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  document: DocumentResponse | null;
}

export interface InvoiceDetailResponse extends InvoiceResponse {
  /**
   * `null` when no verification has completed yet. That is a real state: the
   * invoice exists, the run has not happened (or failed to persist), and
   * `POST /api/v1/invoices/:id/verify` can start one.
   */
  verification: VerificationResponse | null;
}

export interface InvoiceListResponse {
  items: InvoiceResponse[];
  pagination: { total: number; limit: number; offset: number };
}

export interface InvoiceHistoryEvent {
  action: string;
  actorUserId: string | null;
  /** Identifiers and state names only — never document contents. */
  metadata: unknown;
  createdAt: string;
}

export interface InvoiceHistoryResponse {
  invoiceId: string;
  /** Newest first. Append-only: an earlier verdict is never replaced. */
  verifications: VerificationResponse[];
  events: InvoiceHistoryEvent[];
}

/** `@db.Date` columns arrive as midnight UTC; only the day is meaningful. */
function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateOnlyOrNull(value: Date | null): string | null {
  return value === null ? null : dateOnly(value);
}

function instantOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function toDocumentResponse(document: InvoiceDocument): DocumentResponse {
  return {
    filename: document.filename,
    mimeType: document.mimeType,
    byteSize: document.byteSize,
    contentSha256: document.contentSha256,
    format: document.format,
    parserVersion: document.parserVersion,
    createdAt: document.createdAt.toISOString(),
  };
}

export function toInvoiceResponse(
  invoice: Invoice,
  document: InvoiceDocument | null,
): InvoiceResponse {
  return {
    id: invoice.id,
    organizationId: invoice.organizationId,
    status: invoice.status,
    invoiceSeries: invoice.invoiceSeries,
    invoiceNumber: invoice.invoiceNumber,
    invoiceType: invoice.invoiceType,
    invoiceTypeName: invoice.invoiceTypeName,
    sellerName: invoice.sellerName,
    sellerTaxId: invoice.issuerTaxId,
    buyerName: invoice.buyerName,
    buyerTaxId: invoice.debtorTaxId,
    currency: invoice.currency,
    amount: invoice.amount.toString(),
    subtotalAmount: invoice.subtotalAmount === null ? null : invoice.subtotalAmount.toString(),
    taxAmount: invoice.taxAmount === null ? null : invoice.taxAmount.toString(),
    issueDate: dateOnly(invoice.issueDate),
    dueDate: dateOnlyOrNull(invoice.dueDate),
    fingerprint: invoice.fingerprint,
    contentHash: invoice.contentHash,
    lastVerifiedAt: instantOrNull(invoice.lastVerifiedAt),
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
    document: document === null ? null : toDocumentResponse(document),
  };
}
