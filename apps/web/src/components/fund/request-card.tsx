import Link from 'next/link';
import { StatusPill, cardShadow } from '@/components/ui';
import { formatDate, formatMoneyCompact } from '@/lib/format';
import { FINANCING_STATUS } from '@/lib/status';
import type { FinancingRequestResponse } from '@/lib/types';
import { formatRateBps, stripGradient, toneRgb } from './format';

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[8.5px] font-bold uppercase tracking-[0.1em] text-lo">{label}</div>
      <div className="truncate text-base font-bold" style={{ color: color ?? 'var(--color-ink)' }}>
        {value}
      </div>
    </div>
  );
}

/** Borrower card of the reference "Yield" list, mapped to one financing request. */
export function RequestCard({ request }: { request: FinancingRequestResponse }) {
  const { invoice } = request;
  const status = FINANCING_STATUS[request.status];
  const initial = Array.from(invoice.sellerName.trim())[0]?.toUpperCase() ?? '?';

  return (
    <Link
      href={`/fund/${request.id}`}
      className="block cursor-pointer overflow-hidden rounded-[20px] bg-surface no-underline transition-all duration-150 hover:-translate-y-0.5"
      style={{ border: '1px solid var(--color-border)', boxShadow: cardShadow }}
    >
      <div className="w-full" style={{ height: 4, background: stripGradient(status.tone) }} />
      <div className="p-5 pb-6">
        <div className="mb-5 flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface2">
            <span className="text-sm font-bold text-primary">{initial}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold leading-tight text-ink">
              {invoice.sellerName}
            </div>
            <div className="mt-[3px] truncate text-[10px] text-muted">
              Hoá đơn {invoice.invoiceSeries}-{invoice.invoiceNumber} · bên mua {invoice.buyerName}
            </div>
          </div>
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        </div>
        <div className="grid grid-cols-2 gap-y-4 border-t border-line pt-4 sm:grid-cols-4">
          <Metric
            label="Số tiền yêu cầu"
            value={formatMoneyCompact(request.requestedAmount, request.currency)}
          />
          <Metric
            label="Lãi suất"
            value={formatRateBps(request.interestRateBps)}
            color={toneRgb(status.tone)}
          />
          <Metric label="Kỳ hạn" value={`${request.termDays} ngày`} />
          <Metric label="Hạn hoá đơn" value={formatDate(invoice.dueDate)} />
        </div>
      </div>
    </Link>
  );
}
