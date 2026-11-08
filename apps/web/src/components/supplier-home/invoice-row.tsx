'use client';

import Link from 'next/link';
import { ProgressBar, StatusPill, TONE_RGB } from '@/components/ui';
import { formatDate, formatMoney, relativeDays } from '@/lib/format';
import { INVOICE_STATUS } from '@/lib/status';
import type { InvoiceResponse } from '@/lib/types';
import { dueTone, stagePercent, stageTone } from './invoice-meta';

const LABEL = 'mb-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-lo';

/** Facility Book row for one invoice; the whole row is the link. */
export function InvoiceRow({ invoice }: { invoice: InvoiceResponse }) {
  const status = INVOICE_STATUS[invoice.status];
  const relative = relativeDays(invoice.dueDate);
  const due = dueTone(invoice.dueDate);
  return (
    <Link
      href={`/invoices/${invoice.id}`}
      className="block cursor-pointer rounded-2xl border border-line bg-surface px-5 py-4 no-underline transition-all duration-150 hover:border-primary/30 hover:shadow-[0_4px_16px_-8px_rgba(90,91,235,0.35)]"
    >
      <div className="flex flex-col gap-4 sm:grid sm:grid-cols-[2fr_1.1fr_1.1fr_1.3fr_140px] sm:items-center sm:gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="truncate text-[15px] font-bold leading-tight text-ink">
              Ký hiệu {invoice.invoiceSeries} · Số {invoice.invoiceNumber}
            </span>
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
          </div>
          <div className="mt-1 truncate text-[11.5px] text-muted">
            {invoice.sellerName} → {invoice.buyerName} · phát hành {formatDate(invoice.issueDate)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:contents">
          <div className="min-w-0">
            <div className={LABEL}>Số tiền</div>
            <div className="truncate text-[14px] font-semibold text-ink">
              {formatMoney(invoice.amount, invoice.currency)}
            </div>
            <div className="text-[11px] text-lo">{invoice.currency}</div>
            <div className="mt-1.5 w-full max-w-[120px]">
              <ProgressBar
                percent={stagePercent(invoice.status)}
                tone={stageTone(invoice.status)}
                height={3}
                track="var(--color-line)"
              />
            </div>
          </div>
          <div className="min-w-0">
            <div className={LABEL}>Thuế</div>
            <div className="truncate text-[14px] font-semibold text-ink">
              {formatMoney(invoice.taxAmount, invoice.currency)}
            </div>
          </div>
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <div className={LABEL}>Hạn thanh toán</div>
            {invoice.dueDate ? (
              <>
                <div
                  className="text-[13.5px] font-semibold"
                  style={{ color: `rgb(${TONE_RGB[due]})` }}
                >
                  {relative}
                </div>
                <div className="text-[11px] text-lo">{formatDate(invoice.dueDate)}</div>
              </>
            ) : (
              <div className="text-[13.5px] font-semibold text-lo">Chưa đặt hạn</div>
            )}
          </div>
        </div>
        <div className="hidden items-center sm:flex sm:justify-end">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-lo"
            aria-hidden
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </div>
      </div>
    </Link>
  );
}
