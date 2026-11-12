import type { Tone } from '@/lib/status';
import { daysUntil } from '@/lib/format';
import type { InvoiceResponse } from '@/lib/types';

export const invoiceTitle = (i: Pick<InvoiceResponse, 'invoiceSeries' | 'invoiceNumber'>) =>
  `${i.invoiceSeries}-${i.invoiceNumber}`;

/** Overdue invoices read as errors, upcoming ones as warnings, as in the reference rows. */
export function dueTone(dueDate: string | null): Tone {
  const d = daysUntil(dueDate);
  return d !== null && d < 0 ? 'error' : 'warning';
}
