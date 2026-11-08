import { KeyValueList, Panel, SectionLabel } from '@/components/ui';
import { formatBytes, formatDate, formatDateTime, formatMoney, relativeDays } from '@/lib/format';
import type { InvoiceResponse } from '@/lib/types';

export function OverviewPanel({ invoice }: { invoice: InvoiceResponse }) {
  const due = relativeDays(invoice.dueDate);
  return (
    <Panel>
      <SectionLabel>Tổng quan hoá đơn</SectionLabel>
      <div className="mt-5 flex items-center justify-between gap-2">
        <p className="m-0 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">Số tiền</p>
        <p className="m-0 text-sm font-bold text-ink">
          {formatMoney(invoice.amount, invoice.currency)}
        </p>
      </div>
      <div className="mt-2">
        <KeyValueList
          rows={[
            { label: 'Tạm tính', value: formatMoney(invoice.subtotalAmount, invoice.currency) },
            { label: 'Thuế', value: formatMoney(invoice.taxAmount, invoice.currency) },
            { label: 'Ngày phát hành', value: formatDate(invoice.issueDate) },
            {
              label: 'Hạn thanh toán',
              value: formatDate(invoice.dueDate),
              aside: due,
            },
            {
              label: 'Bên bán',
              value: invoice.sellerName,
              aside: `MST ${invoice.sellerTaxId}`,
            },
            {
              label: 'Bên mua',
              value: invoice.buyerName,
              aside: invoice.buyerTaxId ? `MST ${invoice.buyerTaxId}` : undefined,
            },
            { label: 'Tiền tệ', value: invoice.currency },
            { label: 'Lần xác minh gần nhất', value: formatDateTime(invoice.lastVerifiedAt) },
            {
              label: 'Tệp gốc',
              value: invoice.document
                ? `${invoice.document.filename} · ${formatBytes(invoice.document.byteSize)}`
                : '—',
            },
          ]}
        />
      </div>
    </Panel>
  );
}
