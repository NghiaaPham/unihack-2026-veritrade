'use client';

import { useState } from 'react';
import {
  ArrowLink,
  EmptyState,
  ErrorBanner,
  HighlightCard,
  SectionLabel,
  Skeleton,
  StatCard,
} from '@/components/ui';
import { InvoiceCard } from '@/components/supplier-home/invoice-card';
import { invoiceTitle } from '@/components/supplier-home/invoice-meta';
import { countStages, loadPortfolio } from '@/components/supplier-home/portfolio';
import { useAsync } from '@/components/supplier-home/use-async';
import { useAuth } from '@/lib/auth';
import {
  daysUntil,
  formatCount,
  formatDate,
  formatLongDate,
  formatMoneyCompact,
  greeting,
  relativeDays,
} from '@/lib/format';
import type { InvoiceResponse } from '@/lib/types';
import Link from 'next/link';

const NOT_DUE_STATUSES = new Set(['SETTLED', 'CANCELLED', 'REJECTED']);

async function loadDashboard() {
  const { items, total } = await loadPortfolio();
  return {
    items,
    total,
    verified: countStages(items, ['VERIFIED', 'REQUESTED', 'RESERVED', 'DECLARED', 'CLOSED']),
    // Verified but not yet reserved on chain.
    anchorable: countStages(items, ['VERIFIED', 'REQUESTED']),
    requested: countStages(items, ['REQUESTED', 'RESERVED']),
    financed: countStages(items, ['DECLARED', 'CLOSED']),
  };
}

function nextDue(items: InvoiceResponse[]): InvoiceResponse | null {
  let best: InvoiceResponse | null = null;
  for (const invoice of items) {
    const d = daysUntil(invoice.dueDate);
    if (d === null || d < 0 || NOT_DUE_STATUSES.has(invoice.status)) continue;
    if (!best || new Date(invoice.dueDate ?? 0) < new Date(best.dueDate ?? 0)) best = invoice;
  }
  return best;
}

export default function DashboardPage() {
  const { session } = useAuth();
  const [now] = useState(() => new Date());
  const state = useAsync(loadDashboard, 'dashboard');
  const givenName = session?.user.displayName.trim().split(/\s+/).at(-1) ?? '';

  return (
    <div>
      <div className="mb-7">
        <h1 className="m-0 text-[22px] font-bold leading-tight tracking-[-0.4px] text-ink sm:text-[26px]">
          {greeting(now)}
          {givenName && `, ${givenName}`}
        </h1>
        <p className="m-0 pt-1.5 text-[12px] text-lo">{formatLongDate(now)}</p>
      </div>

      {state.status === 'error' && <ErrorBanner message={state.message} />}

      {state.status === 'loading' && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[112px] rounded-[20px]" />
            ))}
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <Skeleton className="h-[194px] rounded-[20px]" />
            <Skeleton className="h-[194px] rounded-[20px]" />
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[158px] rounded-[14px]" />
            ))}
          </div>
        </>
      )}

      {state.status === 'ready' && <DashboardBody data={state.data} />}
    </div>
  );
}

function DashboardBody({ data }: { data: Awaited<ReturnType<typeof loadDashboard>> }) {
  const due = nextDue(data.items.map((item) => item.invoice));
  const relative = due ? relativeDays(due.dueDate) : null;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Tổng hoá đơn" value={formatCount(data.total)} />
        <StatCard label="Đã xác minh" value={formatCount(data.verified)} />
        <StatCard label="Chờ tài trợ" value={formatCount(data.requested)} />
        <StatCard label="Đã xác nhận tài trợ" value={formatCount(data.financed)} />
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <HighlightCard
          label="Hoá đơn đến hạn gần nhất"
          value={due ? formatMoneyCompact(due.amount, due.currency) : '—'}
          title={
            due ? `${invoiceTitle(due)} · ${due.buyerName}` : 'Chưa có hoá đơn nào sắp đến hạn'
          }
          caption={
            due
              ? `${formatDate(due.dueDate)} · ${relative}`
              : 'Đặt hạn thanh toán cho hoá đơn để theo dõi tại đây.'
          }
          link={{ href: '/invoices', label: 'Sổ hoá đơn' }}
          glowAt="20%"
        />
        <HighlightCard
          label="Sẵn sàng neo on-chain"
          value={formatCount(data.anchorable)}
          title={
            data.anchorable > 0
              ? 'Hoá đơn đã xác minh, có thể neo cam kết'
              : 'Chưa có hoá đơn chờ neo'
          }
          caption="Neo on-chain chỉ công bố mã băm cam kết của hoá đơn lên Avalanche, không công bố dữ liệu hoá đơn. Nhờ đó hai bên tài trợ không thể cùng tài trợ một hoá đơn."
          link={{ href: '/invoices?status=VERIFIED', label: 'Xem hoá đơn đã xác minh' }}
          glowAt="80%"
        />
      </div>

      <div className="mt-10">
        <div className="mb-4 flex items-center justify-between gap-3">
          <SectionLabel>Hoá đơn của bạn</SectionLabel>
          <ArrowLink href="/invoices">Sổ hoá đơn</ArrowLink>
        </div>
        {data.items.length === 0 ? (
          <EmptyState
            title="Bạn chưa có hoá đơn nào"
            description="Tải lên hoá đơn điện tử XML để hệ thống xác minh tự động và sẵn sàng neo cam kết lên Avalanche."
            action={
              <Link
                href="/invoices/upload"
                className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-xs font-bold text-white no-underline"
              >
                ＋ Tải lên XML
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.slice(0, 6).map((item) => (
              <InvoiceCard key={item.invoice.id} invoice={item.invoice} stage={item.stage} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
