import type { FinancingRequest } from '../generated/prisma/client.js';
import type { InvoiceSummary } from '../invoices/invoice.presenter.js';

/**
 * Financing request API representation.
 *
 * Money leaves as a string, as it does for invoices. `toFixed()` is used rather
 * than `toString()` so an 18-digit fraction such as `0.000000000000000001`
 * is never rendered in exponent notation.
 */
export interface FinancingRequestResponse {
  id: string;
  organizationId: string;
  invoiceId: string;
  requestedById: string;
  requestedAmount: string;
  currency: string;
  status: FinancingRequest['status'];
  termDays: number;
  interestRateBps: number;
  purpose: string;
  createdAt: string;
  updatedAt: string;
  invoice: InvoiceSummary;
}

export interface FinancingRequestListResponse {
  items: FinancingRequestResponse[];
  pagination: { total: number; limit: number; offset: number };
}

export function toFinancingRequestResponse(
  request: FinancingRequest,
  invoice: InvoiceSummary,
): FinancingRequestResponse {
  return {
    id: request.id,
    organizationId: request.organizationId,
    invoiceId: request.invoiceId,
    requestedById: request.requestedById,
    requestedAmount: request.requestedAmount.toFixed(),
    currency: request.currency,
    status: request.status,
    termDays: request.termDays,
    interestRateBps: request.interestRateBps,
    purpose: request.purpose,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    invoice,
  };
}
