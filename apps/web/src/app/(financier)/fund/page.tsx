'use client';

import { useEffect, useMemo, useState } from 'react';
import { LogoMark } from '@/components/shell';
import { EmptyState, ErrorBanner, GhostButton, Skeleton } from '@/components/ui';
import { fold } from '@/components/fund/format';
import { RequestCard } from '@/components/fund/request-card';
import { ApiError, api } from '@/lib/api';
import type { FinancingRequestResponse } from '@/lib/types';

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; items: FinancingRequestResponse[]; total: number }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

export default function FundPage() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [term, setTerm] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .listFinancingRequests({ limit: 50 })
      .then((res) => {
        if (alive) setLoad({ kind: 'ready', items: res.items, total: res.pagination.total });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) setLoad({ kind: 'missing' });
        else
          setLoad({
            kind: 'error',
            message:
              e instanceof ApiError ? e.message : 'Không tải được danh sách yêu cầu tài trợ.',
          });
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const items = useMemo(() => {
    if (load.kind !== 'ready') return [];
    const q = fold(term.trim());
    if (!q) return load.items;
    return load.items.filter((r) =>
      fold(
        [
          r.invoice.sellerName,
          r.invoice.buyerName,
          r.invoice.invoiceSeries,
          r.invoice.invoiceNumber,
          `${r.invoice.invoiceSeries}-${r.invoice.invoiceNumber}`,
        ].join(' '),
      ).includes(q),
    );
  }, [load, term]);

  return (
    <div className="mx-auto max-w-2xl pb-2 pt-2 lg:pb-6 lg:pt-6">
      <div className="flex flex-col items-center text-center">
        <LogoMark size={56} color="rgb(225, 163, 37)" />
        <h1 className="m-0 mt-5 text-[26px] font-bold tracking-[-0.5px] text-ink">
          Yêu cầu tài trợ
        </h1>
        <p className="m-0 mt-2 max-w-md text-sm text-muted">
          Duyệt các hoá đơn đã xác minh đang chờ tài trợ và giữ chỗ claim trên Avalanche.
        </p>
      </div>

      <div className="relative mx-auto mt-8 max-w-md">
        <svg
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="text"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Tìm theo bên bán, bên mua, ký hiệu, số hoá đơn…"
          aria-label="Tìm yêu cầu tài trợ"
          className="min-h-11 w-full rounded-full border border-line-strong bg-surface pl-10 pr-4 text-sm font-medium text-ink outline-none placeholder:text-muted focus:border-primary"
        />
      </div>

      <div className="mt-8">
        {load.kind === 'loading' && (
          <div className="flex flex-col gap-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[170px] rounded-[20px]" />
            ))}
          </div>
        )}

        {load.kind === 'missing' && (
          <EmptyState
            title="Chưa có yêu cầu tài trợ"
            description="Máy chủ chưa cung cấp danh sách yêu cầu tài trợ, hoặc chưa có bên bán nào gửi yêu cầu. Hãy quay lại sau."
          />
        )}

        {load.kind === 'error' && (
          <div className="flex flex-col items-start gap-3">
            <ErrorBanner message={load.message} />
            <GhostButton
              onClick={() => {
                setLoad({ kind: 'loading' });
                setAttempt((n) => n + 1);
              }}
            >
              Thử lại
            </GhostButton>
          </div>
        )}

        {load.kind === 'ready' && load.items.length === 0 && (
          <EmptyState
            title="Chưa có yêu cầu tài trợ"
            description="Khi một bên bán gửi yêu cầu tài trợ cho hoá đơn đã xác minh, yêu cầu sẽ xuất hiện ở đây để bạn giữ chỗ claim."
          />
        )}

        {load.kind === 'ready' && load.items.length > 0 && items.length === 0 && (
          <EmptyState
            title="Không có kết quả phù hợp"
            description={`Không có yêu cầu nào khớp “${term.trim()}”. Thử tìm theo tên bên bán hoặc số hoá đơn khác.`}
          />
        )}

        {items.length > 0 && (
          <div className="flex flex-col gap-4">
            {items.map((r) => (
              <RequestCard key={r.id} request={r} />
            ))}
          </div>
        )}

        {load.kind === 'ready' && load.items.length > 0 && (
          <p className="m-0 mt-6 text-center text-[11px] leading-relaxed text-lo">
            Hiển thị {items.length}/{load.total} yêu cầu của tổ chức đang đăng nhập. API được giới
            hạn theo tổ chức; trong bản demo, một signer máy chủ giữ cả vai trò đăng ký và tài trợ.
          </p>
        )}
      </div>
    </div>
  );
}
