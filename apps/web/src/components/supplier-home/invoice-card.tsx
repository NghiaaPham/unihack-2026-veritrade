'use client';

import Link from 'next/link';
import { ProgressBar, StatusPill, TONE_RGB } from '@/components/ui';
import { formatDate, formatMoney, relativeDays } from '@/lib/format';
import type { InvoiceResponse } from '@/lib/types';
import { dueTone, invoiceTitle } from './invoice-meta';
import { STAGE_META, type Stage } from './portfolio';

/** Facility-style card (Defactor "Your Facilities") for one invoice. */
export function InvoiceCard({ invoice, stage }: { invoice: InvoiceResponse; stage: Stage }) {
  const meta = STAGE_META[stage];
  const relative = relativeDays(invoice.dueDate);
  const due = dueTone(invoice.dueDate);
  return (
    <Link
      href={`/invoices/${invoice.id}`}
      className="flex flex-col rounded-[14px] p-[22px] no-underline transition-all duration-200 hover:-translate-y-0.5"
      style={{
        background: `radial-gradient(ellipse at 20% 0%, rgba(${TONE_RGB.primary}, 0.078) 0%, transparent 55%), var(--color-surface)`,
        border: `1px solid rgba(${TONE_RGB.primary}, 0.19)`,
        boxShadow: `rgba(${TONE_RGB.primary}, 0.25) 0px 10px 28px -16px`,
      }}
    >
      <div className="mb-3 flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <div className="truncate text-[14.5px] font-bold tracking-[-0.2px] text-ink">
            {invoiceTitle(invoice)}
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-lo">{invoice.buyerName}</div>
        </div>
        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
      </div>
      <div className="mb-1.5 flex justify-between gap-2 text-[11.5px] text-lo">
        <span className="truncate">{formatMoney(invoice.amount, invoice.currency)}</span>
        <span className="shrink-0">Tiến trình {meta.percent}%</span>
      </div>
      <ProgressBar percent={meta.percent} tone={meta.tone === 'neutral' ? 'primary' : meta.tone} />
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-lo">Phát hành {formatDate(invoice.issueDate)}</span>
        {relative && (
          <span
            className="shrink-0 text-[11.5px] font-semibold"
            style={{ color: `rgb(${TONE_RGB[due]})` }}
          >
            {relative}
          </span>
        )}
      </div>
    </Link>
  );
}
