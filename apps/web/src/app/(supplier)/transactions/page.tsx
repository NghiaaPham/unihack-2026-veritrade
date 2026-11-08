'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  PillTabs,
  Skeleton,
  StatCard,
  StatusPill,
} from '@/components/ui';
import { api } from '@/lib/api';
import { explorerTx } from '@/lib/chain';
import { formatCount, formatDateTime, shortHash } from '@/lib/format';
import { OPERATION_KIND, OPERATION_STATUS } from '@/lib/status';
import type { BlockchainOperationResponse, InvoiceResponse, OperationStatus } from '@/lib/types';

type TxTab = 'all' | 'active' | 'history';

interface TxRow {
  invoice: InvoiceResponse;
  operation: BlockchainOperationResponse;
}

interface TxData {
  rows: TxRow[];
  anchoredInvoices: number;
  total: number;
  failedLookups: number;
}

const IN_FLIGHT: OperationStatus[] = ['PENDING', 'SUBMITTING', 'SUBMITTED', 'UNKNOWN'];
const LIST_LIMIT = 50;
const CONCURRENCY = 5;
const GRID = 'sm:grid-cols-[1.6fr_1.4fr_1.2fr_1.2fr_auto]';

async function loadTransactions(): Promise<TxData> {
  const list = await api.listInvoices({
    limit: LIST_LIMIT,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  const rows: TxRow[] = [];
  let anchoredInvoices = 0;
  let failedLookups = 0;
  let next = 0;

  async function worker() {
    while (next < list.items.length) {
      const invoice = list.items[next++];
      if (!invoice) return;
      try {
        const status = await api.anchorStatus(invoice.id);
        if (status.anchored) anchoredInvoices += 1;
        if (status.operation) rows.push({ invoice, operation: status.operation });
      } catch {
        failedLookups += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  rows.sort((a, b) => b.operation.createdAt.localeCompare(a.operation.createdAt));
  return { rows, anchoredInvoices, total: list.pagination.total, failedLookups };
}

export default function TransactionsPage() {
  const [data, setData] = useState<TxData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TxTab>('all');

  useEffect(() => {
    let cancelled = false;
    loadTransactions().then(
      (result) => {
        if (!cancelled) setData(result);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Không tải được giao dịch.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      confirmed: rows.filter((r) => r.operation.status === 'CONFIRMED').length,
      active: rows.filter((r) => IN_FLIGHT.includes(r.operation.status)).length,
      failed: rows.filter((r) => r.operation.status === 'FAILED').length,
    };
  }, [data]);

  const visible = useMemo(() => {
    const rows = data?.rows ?? [];
    if (tab === 'active') return rows.filter((r) => IN_FLIGHT.includes(r.operation.status));
    if (tab === 'history') return rows.filter((r) => !IN_FLIGHT.includes(r.operation.status));
    return rows;
  }, [data, tab]);

  return (
    <div>
      <PageHeader
        title="Giao dịch on-chain"
        subtitle="Mọi thao tác ghi lên Avalanche của tổ chức bạn — neo, giữ chỗ, xác nhận tài trợ, đóng claim."
      />

      {error && (
        <div className="mt-6">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Đã xác nhận"
          tone="success"
          value={data ? formatCount(counts.confirmed) : '—'}
          hint="Giao dịch đã được ghi nhận trên chuỗi"
        />
        <StatCard
          label="Đang xử lý"
          tone="warning"
          value={data ? formatCount(counts.active) : '—'}
          hint="Chờ gửi, đã gửi hoặc đang đối soát"
        />
        <StatCard
          label="Thất bại"
          tone="error"
          value={data ? formatCount(counts.failed) : '—'}
          hint="Cần kiểm tra lại từng hoá đơn"
        />
        <StatCard
          label="Hoá đơn đã neo"
          tone="primary"
          value={data ? formatCount(data.anchoredInvoices) : '—'}
          hint={data ? `Trên ${formatCount(data.total)} hoá đơn` : undefined}
        />
      </div>

      <div className="mt-8">
        <PillTabs<TxTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'all', label: 'Tất cả' },
            { value: 'active', label: 'Đang xử lý' },
            { value: 'history', label: 'Lịch sử' },
          ]}
        />

        <div className="mt-4">
          {!data && !error ? (
            <Skeleton className="h-72 w-full !rounded-[20px]" />
          ) : data && visible.length === 0 ? (
            <EmptyState
              title={
                data.rows.length === 0
                  ? 'Chưa có giao dịch on-chain'
                  : 'Không có giao dịch trong mục này'
              }
              description={
                data.rows.length === 0
                  ? 'Mở một hoá đơn đã xác minh và chọn “Neo on-chain” để ghi mã cam kết lên Avalanche.'
                  : 'Chuyển sang tab khác để xem các giao dịch còn lại.'
              }
              action={
                data.rows.length === 0 ? (
                  <Link
                    href="/invoices"
                    className="text-xs font-bold text-primary no-underline hover:underline"
                  >
                    Đến sổ hoá đơn
                  </Link>
                ) : undefined
              }
            />
          ) : (
            data && <TxTable rows={visible} />
          )}
        </div>

        {data && (
          <p className="m-0 mt-3 px-1 text-[11px] text-muted">
            Hiển thị thao tác neo gần nhất của tối đa {LIST_LIMIT} hoá đơn.
            {data.failedLookups > 0 &&
              ` Không đọc được trạng thái của ${formatCount(data.failedLookups)} hoá đơn.`}
          </p>
        )}
      </div>
    </div>
  );
}

function TxTable({ rows }: { rows: TxRow[] }) {
  return (
    <div
      className="overflow-hidden rounded-[20px] bg-surface"
      style={{
        border: '1px solid var(--color-border)',
        boxShadow: 'rgba(7, 1, 24, 0.06) 0px 1px 6px',
      }}
    >
      <div className={`hidden border-b border-line bg-bg px-5 py-3 sm:grid sm:gap-4 ${GRID}`}>
        {['Thao tác', 'Hoá đơn', 'Tx hash', 'Thời điểm', 'Trạng thái'].map((c) => (
          <span key={c} className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-lo">
            {c}
          </span>
        ))}
      </div>
      {rows.map(({ invoice, operation }, i) => {
        const status = OPERATION_STATUS[operation.status];
        const href = operation.txHash ? explorerTx(operation.txHash, operation.chainId) : null;
        return (
          <Link
            key={operation.id}
            href={`/invoices/${invoice.id}`}
            className={`grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 px-5 py-4 text-inherit no-underline transition-colors hover:bg-surface2 sm:gap-4 ${GRID} ${
              i < rows.length - 1 ? 'border-b border-line' : ''
            }`}
          >
            <div className="min-w-0 sm:order-1">
              <div className="text-[13px] font-semibold text-ink">
                {OPERATION_KIND[operation.kind]}
              </div>
              <div className="truncate text-[11px] text-lo">
                {invoice.invoiceSeries}/{invoice.invoiceNumber}
              </div>
            </div>
            <div className="flex items-center justify-end sm:order-5 sm:justify-start">
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
            </div>
            <div className="min-w-0 truncate text-[12.5px] text-muted sm:order-2">
              {invoice.sellerName} → {invoice.buyerName}
            </div>
            <div className="min-w-0 text-[12px] sm:order-3">
              {operation.txHash ? (
                href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="font-semibold text-primary no-underline hover:underline"
                  >
                    {shortHash(operation.txHash)}
                  </a>
                ) : (
                  <span className="font-mono text-muted">{shortHash(operation.txHash)}</span>
                )
              ) : (
                <span className="text-lo">—</span>
              )}
              {operation.error && (
                <div className="pt-0.5 text-[10px] text-error">{operation.error.message}</div>
              )}
            </div>
            <div className="hidden text-[12px] text-muted sm:order-4 sm:block">
              {formatDateTime(
                operation.confirmedAt ?? operation.submittedAt ?? operation.createdAt,
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
