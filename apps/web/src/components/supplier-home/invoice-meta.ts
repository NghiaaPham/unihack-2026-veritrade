import type { Tone } from '@/lib/status';
import { daysUntil } from '@/lib/format';
import type { InvoiceResponse, InvoiceStatus } from '@/lib/types';

/** Lifecycle position; verification readiness is not part of the list payload. */
const STAGE: Record<InvoiceStatus, number> = {
  DRAFT: 25,
  SUBMITTED: 25,
  UNDER_REVIEW: 25,
  VERIFIED: 50,
  REJECTED: 0,
  FINANCING_REQUESTED: 75,
  FINANCED: 100,
  SETTLED: 100,
  CANCELLED: 0,
};

export const stagePercent = (status: InvoiceStatus): number => STAGE[status];

export function stageTone(status: InvoiceStatus): Tone {
  if (status === 'REJECTED') return 'error';
  if (STAGE[status] === 100) return 'success';
  return 'primary';
}

export const invoiceTitle = (i: Pick<InvoiceResponse, 'invoiceSeries' | 'invoiceNumber'>) =>
  `${i.invoiceSeries}-${i.invoiceNumber}`;

/** Overdue invoices read as errors, upcoming ones as warnings, as in the reference rows. */
export function dueTone(dueDate: string | null): Tone {
  const d = daysUntil(dueDate);
  return d !== null && d < 0 ? 'error' : 'warning';
}
