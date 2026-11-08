'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  CopyHash,
  DetailGrid,
  DetailPanel,
  OutlineChip,
  RefreshIcon,
  StatusIcon,
} from '@/components/verification/parts';
import {
  BackLink,
  EmptyState,
  ErrorBanner,
  ProgressBar,
  SectionLabel,
  SmallButton,
  Skeleton,
} from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { formatDate, formatMoney, shortHash } from '@/lib/format';
import { CHECK_LABEL, CHECK_STATUS, VERIFICATION_STATUS, readiness } from '@/lib/status';
import type { InvoiceDetailResponse, VerificationResponse } from '@/lib/types';

const errorMessage = (e: unknown) =>
  e instanceof ApiError ? e.message : 'Không thể tải dữ liệu. Vui lòng thử lại.';

const topCard = 'rounded-[20px] bg-surface p-5';
const topLabel = 'm-0 text-[10px] font-bold uppercase tracking-[0.1em] text-lo';
const topValue = 'm-0 mt-1 text-2xl font-extrabold leading-tight text-ink break-words';

export default function VerificationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetailResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getInvoice(id);
        if (!cancelled) setInvoice(data);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const reverify = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const verification = await api.verify(id);
      setInvoice((prev) =>
        prev ? { ...prev, verification, lastVerifiedAt: verification.checkedAt } : prev,
      );
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (notFound) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <BackLink href="/verification">Xác minh</BackLink>
        <EmptyState
          title="Không tìm thấy hoá đơn"
          description="Hoá đơn không tồn tại hoặc không thuộc tổ chức của bạn."
          action={
            <Link href="/verification" className="text-xs font-bold text-primary hover:underline">
              Quay lại danh sách xác minh
            </Link>
          }
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <BackLink href="/verification">Xác minh</BackLink>
        <ErrorBanner message={error} />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <BackLink href="/verification">Xác minh</BackLink>
        <Skeleton className="h-16 w-1/2" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[88px] rounded-[20px]" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-[20px]" />
        <Skeleton className="h-48 rounded-[20px]" />
      </div>
    );
  }

  const verification = invoice.verification;
  const status = verification ? VERIFICATION_STATUS[verification.status] : null;
  const percent = verification ? readiness(verification.checks) : null;
  const barTone = verification?.status === 'FAILED' ? 'error' : 'success';
  const updatedAt = verification ? (verification.checkedAt ?? verification.createdAt) : null;
  const title = `${invoice.invoiceSeries}-${invoice.invoiceNumber}`;
  const doc = invoice.document;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/verification">Xác minh</BackLink>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <SectionLabel>Kết quả xác minh</SectionLabel>
          <h1 className="m-0 mt-1 truncate text-[22px] font-bold leading-tight tracking-[-0.4px] text-ink">
            {title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <OutlineChip tone={status?.tone ?? 'neutral'}>
              {status?.label ?? 'Chưa xác minh'}
            </OutlineChip>
            {doc && (
              <OutlineChip tone="primary" soft>
                {doc.format.split('_')[0]}
              </OutlineChip>
            )}
            {updatedAt && (
              <span className="text-[11px] text-muted">Cập nhật {formatDate(updatedAt)}</span>
            )}
          </div>
        </div>
        <SmallButton onClick={reverify} disabled={busy} className="!min-h-11 !text-sm">
          <RefreshIcon size={14} spinning={busy} /> {busy ? 'Đang xác minh…' : 'Xác minh lại'}
        </SmallButton>
      </header>

      {actionError && <ErrorBanner message={actionError} />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className={topCard} style={{ border: '1px solid var(--color-border)' }}>
          <p className={topLabel}>Mức sẵn sàng</p>
          <p
            className="m-0 mt-1 text-2xl font-extrabold"
            style={{ color: `var(--color-${percent === null ? 'lo' : barTone})` }}
          >
            {percent === null ? '—' : `${percent}%`}
          </p>
          <div className="mt-2">
            <ProgressBar
              percent={percent ?? 0}
              tone={barTone}
              height={8}
              track="var(--color-border)"
            />
          </div>
        </div>
        <div className={topCard} style={{ border: '1px solid var(--color-border)' }}>
          <p className={topLabel}>Phạm vi</p>
          <p className={topValue}>{verification ? 'Cục bộ' : '—'}</p>
        </div>
        <div className={topCard} style={{ border: '1px solid var(--color-border)' }}>
          <p className={topLabel}>Loại chứng từ</p>
          <p className={topValue}>{invoice.invoiceTypeName ?? invoice.invoiceType}</p>
        </div>
      </div>

      <DetailPanel title="Phân loại">
        <DetailGrid
          fields={[
            { label: 'Loại hoá đơn', value: invoice.invoiceTypeName ?? invoice.invoiceType },
            { label: 'Định dạng tệp', value: doc ? doc.format : 'Nhập từ metadata' },
            { label: 'Phiên bản bộ phân tích', value: doc ? doc.parserVersion : '—' },
          ]}
        />
      </DetailPanel>

      <DetailPanel title="Bên bán">
        <DetailGrid
          fields={[
            { label: 'Tên', value: invoice.sellerName },
            { label: 'Mã số thuế', value: invoice.sellerTaxId },
          ]}
        />
      </DetailPanel>

      <DetailPanel title="Bên mua">
        <DetailGrid
          fields={[
            { label: 'Tên', value: invoice.buyerName },
            { label: 'Mã số thuế', value: invoice.buyerTaxId },
          ]}
        />
      </DetailPanel>

      <DetailPanel title="Chi tiết giao dịch">
        <DetailGrid
          fields={[
            { label: 'Ký hiệu', value: invoice.invoiceSeries },
            { label: 'Số', value: invoice.invoiceNumber },
            { label: 'Ngày phát hành', value: formatDate(invoice.issueDate) },
            { label: 'Hạn thanh toán', value: formatDate(invoice.dueDate) },
            { label: 'Tiền tệ', value: invoice.currency },
            { label: 'Tạm tính', value: formatMoney(invoice.subtotalAmount, invoice.currency) },
            { label: 'Thuế', value: formatMoney(invoice.taxAmount, invoice.currency) },
            { label: 'Tổng tiền', value: formatMoney(invoice.amount, invoice.currency) },
          ]}
        />
      </DetailPanel>

      <DetailPanel title="Dấu vân tay">
        <DetailGrid
          fields={[
            {
              label: 'Fingerprint SHA-256',
              value: (
                <CopyHash value={invoice.fingerprint} short={shortHash(invoice.fingerprint)} />
              ),
            },
            {
              label: 'Content hash',
              value: (
                <CopyHash value={invoice.contentHash} short={shortHash(invoice.contentHash)} />
              ),
            },
          ]}
        />
      </DetailPanel>

      <DetailPanel title="Các bước kiểm tra">
        {verification && verification.checks.length > 0 ? (
          <div className="space-y-3">
            {verification.checks.map((check) => {
              const result = CHECK_STATUS[check.status];
              const kind =
                check.status === 'PASSED' ? 'ok' : result.tone === 'error' ? 'fail' : 'idle';
              return (
                <div
                  key={check.key}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line p-3"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="mt-0.5">
                      <StatusIcon tone={result.tone} kind={kind} />
                    </span>
                    <div className="min-w-0">
                      <span className="text-sm font-semibold text-ink">
                        {CHECK_LABEL[check.key] ?? check.label}
                      </span>
                      {check.message && (
                        <p className="m-0 pt-0.5 text-[11px] text-muted">{check.message}</p>
                      )}
                    </div>
                  </div>
                  <OutlineChip tone={result.tone}>{result.label}</OutlineChip>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="m-0 text-xs text-muted">
            Hoá đơn này chưa có kết quả kiểm tra. Nhấn “Xác minh lại” để chạy các bước kiểm tra.
          </p>
        )}
      </DetailPanel>

      {verification && verification.limitations.length > 0 && (
        <DetailPanel title="Giới hạn">
          <ul className="m-0 list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-muted">
            {verification.limitations.map((limitation, i) => (
              <li key={i}>{limitation}</li>
            ))}
          </ul>
        </DetailPanel>
      )}

      <DetailPanel title="Đánh giá">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="m-0 text-sm font-semibold text-ink">{reviewHeadline(verification)}</p>
            <p className="m-0 pt-1 text-xs text-muted">
              Đối chiếu với cơ quan thuế chưa được tích hợp — đây là kết quả kiểm tra cục bộ, không
              phải xác nhận của cơ quan thuế.
            </p>
          </div>
          <Link
            href={`/invoices/${invoice.id}`}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface px-5 text-sm font-bold text-ink no-underline transition-colors hover:bg-surface2"
          >
            Mở hoá đơn
          </Link>
        </div>
      </DetailPanel>
    </div>
  );
}

function reviewHeadline(verification: VerificationResponse | null): string {
  switch (verification?.status) {
    case 'PASSED':
      return 'Hoá đơn đã đạt toàn bộ các bước kiểm tra.';
    case 'PARTIAL':
      return 'Hoá đơn đã qua kiểm tra cục bộ và đủ điều kiện neo on-chain.';
    case 'FAILED':
      return 'Hoá đơn chưa đạt — cần xử lý các bước không đạt trước khi neo.';
    case 'PENDING':
      return 'Kết quả xác minh đang chờ xử lý.';
    default:
      return 'Hoá đơn chưa được xác minh.';
  }
}
