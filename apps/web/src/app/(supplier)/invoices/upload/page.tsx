'use client';

import Link from 'next/link';
import { useRef, useState, type DragEvent } from 'react';
import {
  BackLink,
  ErrorBanner,
  GhostButton,
  Notice,
  PageHeader,
  PrimaryButton,
  SectionLabel,
  Spinner,
  StatusPill,
  TONE_RGB,
  TopStripPanel,
} from '@/components/ui';
import { invoiceTitle } from '@/components/supplier-home/invoice-meta';
import { api, ApiError } from '@/lib/api';
import { formatBytes, formatMoney } from '@/lib/format';
import { CHECK_LABEL, CHECK_STATUS, INVOICE_STATUS, VERIFICATION_STATUS } from '@/lib/status';
import type { InvoiceDetailResponse } from '@/lib/types';

const MAX_BYTES = 2 * 1024 * 1024;

const STEPS = [
  { title: 'Tải lên XML', body: 'Tải hoá đơn điện tử gốc; tệp được lưu riêng tư trên máy chủ.' },
  {
    title: 'Xác minh tự động 7 bước',
    body: 'Cấu trúc, trường bắt buộc, khớp tổng tiền, trùng lặp, chữ ký số và đối chiếu thuế.',
  },
  {
    title: 'Neo cam kết lên Avalanche',
    body: 'Chỉ mã băm cam kết được công bố on-chain, không có dữ liệu hoá đơn.',
  },
  {
    title: 'Bên tài trợ giữ chỗ & xác nhận',
    body: 'Một hoá đơn chỉ có thể được một bên tài trợ giữ chỗ tại một thời điểm.',
  },
];

function describeUploadError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Không thể tải lên hoá đơn. Vui lòng thử lại.';
  switch (error.code) {
    case 'UNSUPPORTED_INVOICE_FORMAT':
      return 'Định dạng hoá đơn chưa được hỗ trợ. Hệ thống chỉ nhận XML theo Thông tư 78/2021 (HDon/DLHDon) và Thông tư 32/2011.';
    case 'INVALID_INVOICE_DOCUMENT':
      return 'Tệp XML không hợp lệ hoặc thiếu trường bắt buộc, nên không đọc được hoá đơn.';
    case 'DOCUMENT_TOO_LARGE':
      return 'Tệp vượt quá giới hạn 2 MB. Hãy chọn tệp nhỏ hơn.';
    case 'DUPLICATE_INVOICE':
      return 'Hoá đơn này đã được tải lên trước đó (trùng nội dung).';
    case 'CONFLICTING_INVOICE':
      return 'Đã có hoá đơn khác dùng cùng ký hiệu và số hoá đơn nhưng nội dung khác. Kiểm tra lại tệp của bạn.';
  }
  switch (error.status) {
    case 413:
      return 'Tệp vượt quá giới hạn 2 MB. Hãy chọn tệp nhỏ hơn.';
    case 422:
      return 'Không đọc được hoá đơn từ tệp này. Hãy kiểm tra lại định dạng XML.';
    case 409:
      return 'Hoá đơn này đã tồn tại trong hệ thống.';
    case 400:
      return `Yêu cầu chưa hợp lệ: ${error.message}`;
    case 403:
      return 'Vai trò của bạn không có quyền tải lên hoá đơn.';
    default:
      return error.message;
  }
}

function checkFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.xml')) return 'Chỉ chấp nhận tệp có đuôi .xml.';
  if (file.size === 0) return 'Tệp rỗng.';
  if (file.size > MAX_BYTES) return `Tệp ${formatBytes(file.size)} vượt quá giới hạn 2 MB.`;
  return null;
}

export default function UploadInvoicePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InvoiceDetailResponse | null>(null);

  function pick(next: File | undefined) {
    if (!next) return;
    const problem = checkFile(next);
    setError(problem);
    setFile(problem ? null : next);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!busy) pick(event.dataTransfer.files[0]);
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.uploadInvoice(file, dueDate || undefined));
    } catch (e) {
      setError(describeUploadError(e));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setFile(null);
    setDueDate('');
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <section className="px-5 py-6 lg:px-8 lg:py-8">
      <BackLink href="/invoices">Quay lại sổ hoá đơn</BackLink>
      <div className="mt-4">
        <PageHeader
          title="Tải lên hoá đơn điện tử"
          subtitle="Hệ thống đọc XML, xác minh tự động và chuẩn bị hoá đơn để neo cam kết."
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <TopStripPanel>
          <div className="p-6">
            {result ? (
              <UploadSuccess invoice={result} onAgain={reset} />
            ) : (
              <>
                <Notice>
                  Hỗ trợ XML hoá đơn điện tử theo Thông tư 78/2021 (HDon/DLHDon) và Thông tư
                  32/2011, tối đa 2 MB. Tệp gốc được lưu riêng tư; chỉ mã băm cam kết mới có thể
                  được công bố on-chain.
                </Notice>

                <label
                  htmlFor="invoice-file"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className="mt-5 flex cursor-pointer flex-col items-center rounded-2xl px-6 py-10 text-center transition-colors focus-within:border-primary"
                  style={{
                    border: `1.5px dashed ${dragging ? `rgb(${TONE_RGB.primary})` : 'var(--color-line-strong)'}`,
                    background: dragging ? `rgba(${TONE_RGB.primary}, 0.06)` : 'var(--color-bg)',
                  }}
                >
                  <input
                    ref={inputRef}
                    id="invoice-file"
                    type="file"
                    accept=".xml,text/xml,application/xml"
                    className="sr-only"
                    disabled={busy}
                    onChange={(e) => pick(e.target.files?.[0])}
                  />
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={`rgb(${TONE_RGB.primary})`}
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
                  </svg>
                  {file ? (
                    <>
                      <p className="m-0 mt-3 text-sm font-bold text-ink">{file.name}</p>
                      <p className="m-0 mt-1 text-xs text-muted">
                        {formatBytes(file.size)} · bấm để chọn tệp khác
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="m-0 mt-3 text-sm font-bold text-ink">Kéo thả tệp XML vào đây</p>
                      <p className="m-0 mt-1 text-xs text-muted">
                        hoặc bấm để chọn tệp từ máy tính
                      </p>
                    </>
                  )}
                </label>

                <label className="mt-5 block max-w-[260px]">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-lo">
                    Hạn thanh toán (không bắt buộc)
                  </span>
                  <input
                    type="date"
                    value={dueDate}
                    disabled={busy}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-[13px] text-ink outline-none transition-colors focus:border-primary"
                  />
                </label>

                {error && (
                  <div className="mt-5">
                    <ErrorBanner message={error} />
                  </div>
                )}

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <PrimaryButton onClick={upload} disabled={!file || busy}>
                    {busy && <Spinner />}
                    {busy ? 'Đang tải lên và xác minh…' : 'Tải lên và xác minh'}
                  </PrimaryButton>
                  {file && !busy && (
                    <GhostButton onClick={reset} className="min-h-12 justify-center px-5">
                      Bỏ chọn
                    </GhostButton>
                  )}
                </div>
              </>
            )}
          </div>
        </TopStripPanel>

        <div
          className="flex h-fit flex-col rounded-[14px] p-[22px]"
          style={{
            background: `radial-gradient(ellipse at 20% 0%, rgba(${TONE_RGB.primary}, 0.078) 0%, transparent 55%), var(--color-surface)`,
            border: `1px solid rgba(${TONE_RGB.primary}, 0.19)`,
            boxShadow: `rgba(${TONE_RGB.primary}, 0.25) 0px 10px 28px -16px`,
          }}
        >
          <SectionLabel>Quy trình 4 bước</SectionLabel>
          <ol className="m-0 mt-4 flex list-none flex-col gap-4 p-0">
            {STEPS.map((step, i) => {
              const done = result !== null && i < 2;
              return (
                <li key={step.title} className="flex gap-3">
                  <span
                    className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                    style={{
                      background: done
                        ? `rgb(${TONE_RGB.success})`
                        : `rgba(${TONE_RGB.primary}, 0.1)`,
                      color: done ? '#fff' : `rgb(${TONE_RGB.primary})`,
                    }}
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[14.5px] font-bold tracking-[-0.2px] text-ink">
                      {step.title}
                    </div>
                    <div className="mt-0.5 text-[11.5px] leading-relaxed text-lo">{step.body}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}

function UploadSuccess({
  invoice,
  onAgain,
}: {
  invoice: InvoiceDetailResponse;
  onAgain: () => void;
}) {
  const status = INVOICE_STATUS[invoice.status];
  const verification = invoice.verification;
  const verdict = verification ? VERIFICATION_STATUS[verification.status] : null;
  return (
    <div>
      <SectionLabel tone="success">Tải lên thành công</SectionLabel>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <h3 className="m-0 text-[20px] font-bold tracking-[-0.4px] text-ink">
          {invoiceTitle(invoice)}
        </h3>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
        {verdict && <StatusPill tone={verdict.tone}>{verdict.label}</StatusPill>}
      </div>
      <p className="m-0 mt-1 text-[12.5px] text-muted">
        {invoice.sellerName} → {invoice.buyerName} · {formatMoney(invoice.amount, invoice.currency)}
      </p>

      <div className="mt-5">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
          7 bước kiểm tra
        </div>
        {verification && verification.checks.length > 0 ? (
          <ul className="m-0 flex list-none flex-col p-0">
            {verification.checks.map((check, i) => {
              const s = CHECK_STATUS[check.status];
              return (
                <li
                  key={check.key}
                  className={`flex items-center justify-between gap-3 py-2.5 ${i > 0 ? 'border-t border-line' : ''}`}
                >
                  <span className="min-w-0 truncate text-[13px] font-semibold text-ink">
                    {CHECK_LABEL[check.key] ?? check.label}
                  </span>
                  <StatusPill tone={s.tone}>{s.label}</StatusPill>
                </li>
              );
            })}
          </ul>
        ) : (
          <Notice tone="warning">
            Chưa có kết quả xác minh. Mở chi tiết hoá đơn để chạy xác minh.
          </Notice>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link
          href={`/invoices/${invoice.id}`}
          className="inline-flex min-h-12 items-center justify-center rounded-full px-6 text-sm font-bold text-white no-underline transition-all"
          style={{
            background: 'rgb(90, 91, 235)',
            boxShadow: 'rgba(90, 91, 235, 0.267) 0px 2px 8px',
          }}
        >
          Xem chi tiết hoá đơn
        </Link>
        <GhostButton onClick={onAgain} className="min-h-12 justify-center px-5">
          Tải lên hoá đơn khác
        </GhostButton>
      </div>
    </div>
  );
}
