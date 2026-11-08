'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { mapPool } from '@/components/verification/pool';
import {
  OutlineChip,
  PillStatCard,
  RefreshIcon,
  relativeTime,
} from '@/components/verification/parts';
import {
  ArrowRight,
  EmptyState,
  ErrorBanner,
  MeshButton,
  Notice,
  PageHeader,
  ProgressBar,
  Skeleton,
  TONE_RGB,
  cardShadow,
} from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { VERIFICATION_STATUS, readiness } from '@/lib/status';
import type { InvoiceResponse, VerificationResponse } from '@/lib/types';

interface Row {
  invoice: InvoiceResponse;
  verification: VerificationResponse | null;
}

const errorMessage = (e: unknown) =>
  e instanceof ApiError ? e.message : 'Không thể tải dữ liệu. Vui lòng thử lại.';

const needsAction = (r: Row) => r.verification === null || r.verification.status === 'FAILED';

export default function VerificationListPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.listInvoices({ limit: 50, sortBy: 'createdAt', sortOrder: 'desc' });
        const loaded = await mapPool(list.items, 5, async (invoice): Promise<Row> => {
          try {
            return { invoice, verification: await api.getVerification(invoice.id) };
          } catch {
            return { invoice, verification: null };
          }
        });
        if (!cancelled) {
          setRows(loaded);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const retry = () => {
    setError(null);
    setRows(null);
    setReloadKey((k) => k + 1);
  };

  const applyVerification = useCallback((id: string, verification: VerificationResponse) => {
    setRows((prev) =>
      prev ? prev.map((r) => (r.invoice.id === id ? { ...r, verification } : r)) : prev,
    );
  }, []);

  const reverifyOne = async (id: string) => {
    setBusyId(id);
    setNotice(null);
    try {
      applyVerification(id, await api.verify(id));
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const reverifyAll = async () => {
    const targets = (rows ?? []).filter(needsAction);
    if (targets.length === 0) return;
    if (
      !window.confirm(
        `Xác minh lại ${targets.length} hoá đơn chưa đạt hoặc chưa có kết quả? Mỗi lần chạy sẽ thêm một bản ghi vào lịch sử xác minh.`,
      )
    ) {
      return;
    }
    setNotice(null);
    let failed = 0;
    setProgress({ done: 0, total: targets.length });
    for (const [i, target] of targets.entries()) {
      try {
        applyVerification(target.invoice.id, await api.verify(target.invoice.id));
      } catch {
        failed += 1;
      }
      setProgress({ done: i + 1, total: targets.length });
    }
    setProgress(null);
    if (failed > 0) setNotice(`${failed}/${targets.length} hoá đơn không xác minh lại được.`);
  };

  const verified = (rows ?? []).filter((r) => r.verification !== null);
  const passedCount = verified.filter((r) => r.verification?.status !== 'FAILED').length;
  const readinessValues = verified.flatMap((r) => {
    const value = r.verification ? readiness(r.verification.checks) : null;
    return value === null ? [] : [value];
  });
  const avgReadiness =
    readinessValues.length > 0
      ? Math.round(readinessValues.reduce((a, b) => a + b, 0) / readinessValues.length)
      : null;
  const pendingCount = (rows ?? []).filter(needsAction).length;
  const running = progress !== null;

  return (
    <div>
      <PageHeader
        title="Xác minh hoá đơn"
        subtitle="Kết quả kiểm tra tự động cho từng hoá đơn điện tử."
        actions={
          <>
            <MeshButton
              onClick={reverifyAll}
              disabled={running || rows === null || pendingCount === 0}
            >
              {progress
                ? `Đang xác minh ${progress.done}/${progress.total}…`
                : 'Xác minh lại tất cả'}
            </MeshButton>
            <Link
              href="/invoices/upload"
              className="inline-flex min-h-12 items-center justify-center rounded-full px-6 text-sm font-bold text-white no-underline transition-all"
              style={{
                background: `rgb(${TONE_RGB.primary})`,
                boxShadow: 'rgba(90, 91, 235, 0.267) 0px 2px 8px',
              }}
            >
              ＋ Tải lên XML
            </Link>
          </>
        }
      />

      {notice && (
        <div className="mt-6">
          <Notice tone="warning">{notice}</Notice>
        </div>
      )}
      {error && (
        <div className="mt-6 flex flex-col gap-3">
          <ErrorBanner message={error} />
          <button
            type="button"
            onClick={retry}
            className="self-start cursor-pointer text-xs font-bold text-primary hover:underline"
          >
            Thử lại
          </button>
        </div>
      )}

      {rows === null && !error && (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[130px] rounded-[20px]" />
            ))}
          </div>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[240px] rounded-[20px]" />
            ))}
          </div>
        </>
      )}

      {rows !== null && (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <PillStatCard
              label="Hoá đơn đã xác minh"
              value={verified.length}
              pill={verified.length > 0 ? `${passedCount} đạt` : 'Chưa có kết quả'}
              hint={`trên ${rows.length} hoá đơn`}
            />
            <PillStatCard
              label="Mức sẵn sàng TB"
              value={avgReadiness === null ? '—' : `${avgReadiness}%`}
              pill={
                avgReadiness === null
                  ? 'Chưa có dữ liệu'
                  : `${readinessValues.length} hoá đơn có kết quả`
              }
              pillTone="success"
            />
            <PillStatCard
              label="Cần xử lý"
              value={pendingCount}
              pill={pendingCount === 0 ? 'Tất cả đã xử lý' : `${pendingCount} cần xác minh`}
              pillTone={pendingCount === 0 ? 'success' : 'warning'}
              hint="không đạt hoặc chưa xác minh"
            />
          </div>

          {rows.length === 0 ? (
            <div className="mt-8">
              <EmptyState
                title="Chưa có hoá đơn nào để xác minh"
                description="Tải lên hoá đơn điện tử XML để hệ thống tự động kiểm tra cấu trúc, số tiền, trùng lặp và chữ ký số."
                action={
                  <Link
                    href="/invoices/upload"
                    className="inline-flex min-h-11 items-center justify-center rounded-full px-5 text-xs font-bold text-white no-underline"
                    style={{
                      background: `rgb(${TONE_RGB.primary})`,
                      boxShadow: 'rgba(90, 91, 235, 0.267) 0px 2px 8px',
                    }}
                  >
                    ＋ Tải lên XML
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {rows.map((row) => (
                <VerificationCard
                  key={row.invoice.id}
                  row={row}
                  busy={busyId === row.invoice.id}
                  disabled={running || busyId !== null}
                  onReverify={() => reverifyOne(row.invoice.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VerificationCard({
  row,
  busy,
  disabled,
  onReverify,
}: {
  row: Row;
  busy: boolean;
  disabled: boolean;
  onReverify: () => void;
}) {
  const { invoice, verification } = row;
  const status = verification ? VERIFICATION_STATUS[verification.status] : null;
  const tone = status?.tone ?? 'neutral';
  const percent = verification ? readiness(verification.checks) : null;
  const barTone = verification?.status === 'FAILED' ? 'error' : 'success';
  const updated = verification
    ? `Cập nhật ${relativeTime(verification.checkedAt ?? verification.createdAt)}`
    : 'Chưa xác minh';

  return (
    <article
      className="flex flex-col overflow-hidden rounded-[20px] bg-surface transition-all hover:-translate-y-0.5"
      style={{ border: '1px solid var(--color-border)', boxShadow: cardShadow }}
    >
      <div
        className="w-full"
        style={{
          height: 4,
          background: `linear-gradient(90deg, rgb(${TONE_RGB[tone]}) 0%, rgba(${TONE_RGB[tone]}, 0.8) 50%, transparent 100%)`,
        }}
      />
      <div className="flex flex-1 flex-col p-5">
        <p
          className="m-0 text-[10px] font-bold uppercase tracking-[0.12em]"
          style={{ color: `rgb(${TONE_RGB[tone]})` }}
        >
          {status?.label ?? 'Chưa xác minh'}
        </p>
        <h3 className="m-0 mt-1.5 truncate text-lg font-bold tracking-[-0.3px] text-ink">
          {invoice.invoiceSeries}-{invoice.invoiceNumber}
        </h3>
        <p className="m-0 mt-1 truncate text-xs text-muted">
          {invoice.buyerName} · {updated}
        </p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-lo">
                Mức sẵn sàng
              </span>
              <span
                className="text-sm font-bold"
                style={{ color: `rgb(${TONE_RGB[percent === null ? 'neutral' : barTone]})` }}
              >
                {percent === null ? '—' : `${percent}%`}
              </span>
            </div>
            <div className="mt-2">
              <ProgressBar
                percent={percent ?? 0}
                tone={barTone}
                height={8}
                track="var(--color-border)"
              />
            </div>
          </div>
          {invoice.document?.format && (
            <OutlineChip tone="primary" soft>
              {invoice.document.format.split('_')[0]}
            </OutlineChip>
          )}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <Link
            href={`/verification/${invoice.id}`}
            className="inline-flex min-h-9 items-center gap-1 text-xs font-bold text-primary no-underline transition-colors hover:underline"
          >
            Xem chi tiết <ArrowRight />
          </Link>
          <button
            type="button"
            onClick={onReverify}
            disabled={disabled}
            className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-full border border-line bg-surface px-3 text-[11px] font-bold text-ink transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshIcon spinning={busy} /> {busy ? 'Đang chạy…' : 'Xác minh lại'}
          </button>
        </div>
      </div>
    </article>
  );
}
