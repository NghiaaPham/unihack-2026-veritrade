'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import {
  EmptyState,
  ErrorBanner,
  GhostButton,
  MeshButton,
  PageHeader,
  SectionLabel,
  Segmented,
  Skeleton,
  StatCard,
} from '@/components/ui';
import { CreateInvoiceModal } from '@/components/supplier-home/create-invoice-modal';
import { InvoiceRow } from '@/components/supplier-home/invoice-row';
import { countStages, loadPortfolio, type Stage } from '@/components/supplier-home/portfolio';
import { useAsync } from '@/components/supplier-home/use-async';
import { formatCount } from '@/lib/format';

const PAGE_SIZE = 20;

/** Filters group derived stages; `?status=` keeps the dashboard's links working. */
const FILTERS = {
  ALL: { label: 'Tất cả', stages: null },
  SUBMITTED: { label: 'Đã nộp', stages: ['SUBMITTED'] },
  VERIFIED: { label: 'Đã xác minh', stages: ['VERIFIED'] },
  FUNDING: { label: 'Chờ tài trợ', stages: ['REQUESTED', 'RESERVED'] },
  DECLARED: { label: 'Đã xác nhận tài trợ', stages: ['DECLARED', 'CLOSED'] },
  FAILED: { label: 'Không đạt', stages: ['FAILED'] },
} satisfies Record<string, { label: string; stages: Stage[] | null }>;

type Filter = keyof typeof FILTERS;

function parseFilter(value: string | null): Filter {
  return value && value in FILTERS ? (value as Filter) : 'ALL';
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={null}>
      <InvoicesView />
    </Suspense>
  );
}

function InvoicesView() {
  const router = useRouter();
  const filter = parseFilter(useSearchParams().get('status'));
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);

  const portfolio = useAsync(loadPortfolio, 'portfolio');
  const all = portfolio.status === 'ready' ? portfolio.data.items : [];
  const stages: readonly Stage[] | null = FILTERS[filter].stages;
  const filtered = stages ? all.filter((item) => stages.includes(item.stage)) : all;
  const page = filtered.slice(offset, offset + PAGE_SIZE);
  const list =
    portfolio.status === 'ready'
      ? ({ status: 'ready', data: { items: page, total: filtered.length } } as const)
      : portfolio;

  const options = (Object.keys(FILTERS) as Filter[]).map((value) => ({
    value,
    label: FILTERS[value].label,
  }));

  function changeFilter(next: Filter) {
    setOffset(0);
    router.replace(next === 'ALL' ? '/invoices' : `/invoices?status=${next}`);
  }

  const statsData =
    portfolio.status === 'ready'
      ? {
          total: portfolio.data.total,
          verified: countStages(all, ['VERIFIED', 'REQUESTED', 'RESERVED', 'DECLARED', 'CLOSED']),
          requested: countStages(all, ['REQUESTED', 'RESERVED']),
          financed: countStages(all, ['DECLARED', 'CLOSED']),
        }
      : null;
  const stats = portfolio;
  const count = (n: number | undefined) => (n === undefined ? '—' : formatCount(n));

  return (
    <div>
      <PageHeader
        title="Sổ hoá đơn"
        subtitle="Quản lý hoá đơn điện tử của doanh nghiệp bạn."
        actions={
          <>
            <MeshButton onClick={() => setCreating(true)}>Nhập thủ công</MeshButton>
            <Link
              href="/invoices/upload"
              className="inline-flex min-h-12 items-center justify-center rounded-full px-6 text-sm font-bold text-white no-underline transition-all"
              style={{
                background: 'rgb(90, 91, 235)',
                boxShadow: 'rgba(90, 91, 235, 0.267) 0px 2px 8px',
              }}
            >
              ＋ Tải lên XML
            </Link>
          </>
        }
      />

      {stats.status === 'error' && (
        <div className="mt-6">
          <ErrorBanner message={stats.message} />
        </div>
      )}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tổng hoá đơn"
          value={count(statsData?.total)}
          hint="Trong sổ của doanh nghiệp"
        />
        <StatCard
          label="Đã xác minh"
          value={count(statsData?.verified)}
          hint="Sẵn sàng neo cam kết"
        />
        <StatCard
          label="Chờ tài trợ"
          value={count(statsData?.requested)}
          hint="Đang chờ bên tài trợ"
          tone="warning"
        />
        <StatCard
          label="Đã xác nhận tài trợ"
          value={count(statsData?.financed)}
          hint="Bên tài trợ đã xác nhận"
        />
      </div>

      <div className="mt-10">
        <SectionLabel className="mb-4">Hoá đơn</SectionLabel>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 text-xs text-muted">
            {list.status === 'ready' && list.data.total > 0
              ? `Hiển thị ${formatCount(offset + 1)}–${formatCount(
                  offset + list.data.items.length,
                )} trên tổng ${formatCount(list.data.total)} hoá đơn`
              : list.status === 'ready'
                ? 'Không có hoá đơn nào'
                : 'Đang tải…'}
          </p>
          <Segmented value={filter} options={options} onChange={changeFilter} />
        </div>

        {list.status === 'error' && <ErrorBanner message={list.message} />}
        {list.status === 'loading' && (
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[98px] rounded-2xl" />
            ))}
          </div>
        )}
        {list.status === 'ready' &&
          (list.data.items.length === 0 ? (
            filter === 'ALL' ? (
              <EmptyState
                title="Chưa có hoá đơn nào"
                description="Tải lên hoá đơn điện tử XML hoặc nhập thủ công để bắt đầu xác minh và neo cam kết."
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
              <EmptyState
                title="Không có hoá đơn ở trạng thái này"
                description="Thử chọn trạng thái khác hoặc xem tất cả hoá đơn."
                action={<GhostButton onClick={() => changeFilter('ALL')}>Xem tất cả</GhostButton>}
              />
            )
          ) : (
            <>
              <div className="flex flex-col gap-3">
                {list.data.items.map((item) => (
                  <InvoiceRow key={item.invoice.id} invoice={item.invoice} stage={item.stage} />
                ))}
              </div>
              {list.data.total > PAGE_SIZE && (
                <div className="mt-5 flex items-center justify-between gap-3">
                  <GhostButton
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  >
                    Trước
                  </GhostButton>
                  <span className="text-xs text-muted">
                    Trang {Math.floor(offset / PAGE_SIZE) + 1} /{' '}
                    {Math.ceil(list.data.total / PAGE_SIZE)}
                  </span>
                  <GhostButton
                    disabled={offset + PAGE_SIZE >= list.data.total}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                  >
                    Sau
                  </GhostButton>
                </div>
              )}
            </>
          ))}
      </div>

      {creating && <CreateInvoiceModal onClose={() => setCreating(false)} />}
    </div>
  );
}
