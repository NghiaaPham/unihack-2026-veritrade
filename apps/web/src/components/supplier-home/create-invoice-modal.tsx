'use client';

import { useRouter } from 'next/navigation';
import {
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
  type InputHTMLAttributes,
} from 'react';
import { ErrorBanner, GhostButton, Notice, PrimaryButton, Spinner } from '@/components/ui';
import { API_URL, ApiError, readStoredToken } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ApiErrorBody, InvoiceDetailResponse } from '@/lib/types';

/** Mirrors apps/api/src/invoices/dto/create-invoice.dto.ts. */
const POSITIVE_AMOUNT = /^(?!0+(\.0+)?$)\d{1,20}(\.\d{1,18})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TAX_ID = /^[0-9A-Za-z][0-9A-Za-z-]{5,63}$/;
const SERIES = /^[0-9A-Za-z/._-]{1,32}$/;
const CURRENCY = /^[A-Za-z]{3}$/;

interface FormState {
  invoiceSeries: string;
  invoiceNumber: string;
  invoiceType: string;
  invoiceTypeName: string;
  sellerName: string;
  sellerTaxId: string;
  buyerName: string;
  buyerTaxId: string;
  currency: string;
  amount: string;
  subtotalAmount: string;
  taxAmount: string;
  issueDate: string;
  dueDate: string;
}

type Errors = Partial<Record<keyof FormState, string>>;

function validate(f: FormState): Errors {
  const e: Errors = {};
  const len = (v: string, min: number, max: number) => v.length >= min && v.length <= max;
  if (!SERIES.test(f.invoiceSeries)) e.invoiceSeries = 'Ký hiệu 1–32 ký tự chữ, số hoặc / . _ -';
  if (!len(f.invoiceNumber, 1, 64)) e.invoiceNumber = 'Nhập số hoá đơn (tối đa 64 ký tự).';
  if (!len(f.invoiceType, 1, 16)) e.invoiceType = 'Nhập ký hiệu mẫu số (tối đa 16 ký tự).';
  if (f.invoiceTypeName && !len(f.invoiceTypeName, 1, 160)) e.invoiceTypeName = 'Tối đa 160 ký tự.';
  if (!len(f.sellerName, 1, 255)) e.sellerName = 'Nhập tên bên bán.';
  if (!TAX_ID.test(f.sellerTaxId)) e.sellerTaxId = 'Mã số thuế không hợp lệ (6–64 ký tự).';
  if (!len(f.buyerName, 1, 255)) e.buyerName = 'Nhập tên bên mua.';
  if (!TAX_ID.test(f.buyerTaxId)) e.buyerTaxId = 'Mã số thuế không hợp lệ (6–64 ký tự).';
  if (!CURRENCY.test(f.currency)) e.currency = 'Mã tiền tệ gồm 3 chữ cái, ví dụ VND.';
  if (!POSITIVE_AMOUNT.test(f.amount)) e.amount = 'Số tiền phải lớn hơn 0, không có dấu phân cách.';
  if (f.subtotalAmount && !POSITIVE_AMOUNT.test(f.subtotalAmount))
    e.subtotalAmount = 'Số tiền phải lớn hơn 0, không có dấu phân cách.';
  if (f.taxAmount && !POSITIVE_AMOUNT.test(f.taxAmount))
    e.taxAmount = 'Số tiền phải lớn hơn 0, không có dấu phân cách.';
  if (!ISO_DATE.test(f.issueDate)) e.issueDate = 'Chọn ngày phát hành.';
  if (f.dueDate && !ISO_DATE.test(f.dueDate)) e.dueDate = 'Ngày không hợp lệ.';
  return e;
}

/** The shared client has no createInvoice, so this one call lives here. */
async function createInvoice(body: Record<string, string>): Promise<InvoiceDetailResponse> {
  const token = readStoredToken();
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Không kết nối được tới máy chủ API.');
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const err = (parsed ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      response.status,
      err.code ?? 'ERROR',
      typeof err.message === 'string' ? err.message : `Yêu cầu thất bại (${response.status}).`,
    );
  }
  return parsed as InvoiceDetailResponse;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409)
      return 'Hoá đơn này đã tồn tại (trùng ký hiệu, số hoặc dấu vân tay) trong hệ thống.';
    if (error.status === 403) return 'Vai trò của bạn không có quyền tạo hoá đơn.';
    if (error.status === 400) return `Dữ liệu chưa hợp lệ: ${error.message}`;
    return error.message;
  }
  return 'Không thể tạo hoá đơn. Vui lòng thử lại.';
}

function Field({
  label,
  error,
  className,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-lo">
        {label}
      </span>
      <input
        {...input}
        aria-invalid={error ? true : undefined}
        className="h-11 w-full rounded-xl border bg-surface px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-lo focus:border-primary"
        style={{ borderColor: error ? 'rgb(196, 24, 72)' : 'var(--color-border)' }}
      />
      {error && <span className="mt-1 block text-[11px] text-error">{error}</span>}
    </label>
  );
}

export function CreateInvoiceModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { session } = useAuth();
  const [form, setForm] = useState<FormState>({
    invoiceSeries: '',
    invoiceNumber: '',
    invoiceType: '1',
    invoiceTypeName: '',
    sellerName: session?.organization.name ?? '',
    sellerTaxId: '',
    buyerName: '',
    buyerTaxId: '',
    currency: 'VND',
    amount: '',
    subtotalAmount: '',
    taxAmount: '',
    issueDate: '',
    dueDate: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const bind = (key: keyof FormState) => ({
    value: form[key],
    error: errors[key],
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [key]: event.target.value }));
      setErrors((e) => ({ ...e, [key]: undefined }));
    },
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v.trim()]),
    ) as unknown as FormState;
    const found = validate(trimmed);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(trimmed)) if (v !== '') body[k] = v;
    body.currency = trimmed.currency.toUpperCase();

    setBusy(true);
    setSubmitError(null);
    try {
      const invoice = await createInvoice(body);
      router.push(`/invoices/${invoice.id}`);
    } catch (error) {
      setSubmitError(describeError(error));
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-invoice-title"
        onSubmit={submit}
        noValidate
        className="w-full max-w-[640px] overflow-hidden rounded-[20px] bg-surface"
        style={{
          border: '1px solid var(--color-border)',
          boxShadow: 'rgba(7, 1, 24, 0.24) 0px 16px 48px',
        }}
      >
        <div
          style={{
            height: 5,
            background:
              'linear-gradient(90deg, rgb(90, 91, 235) 0%, rgba(90, 91, 235, 0.8) 50%, transparent 100%)',
          }}
        />
        <div className="p-6 sm:p-7">
          <h3
            id="create-invoice-title"
            className="m-0 text-[20px] font-bold tracking-[-0.4px] text-ink"
          >
            Nhập hoá đơn thủ công
          </h3>
          <p className="m-0 mt-1.5 mb-4 text-[12.5px] leading-relaxed text-muted">
            Tạo hoá đơn từ thông tin có cấu trúc, không kèm tệp gốc. Các bước kiểm tra cần tài liệu
            (cấu trúc XML, chữ ký số) sẽ hiển thị là “Bỏ qua” hoặc “Chưa kiểm tra”.
          </p>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field
              label="Ký hiệu hoá đơn"
              placeholder="C25TAA"
              maxLength={32}
              {...bind('invoiceSeries')}
            />
            <Field
              label="Số hoá đơn"
              placeholder="0000123"
              maxLength={64}
              {...bind('invoiceNumber')}
            />
            <Field label="Ký hiệu mẫu số" placeholder="1" maxLength={16} {...bind('invoiceType')} />
            <Field
              label="Tên loại hoá đơn (không bắt buộc)"
              placeholder="Hóa đơn giá trị gia tăng"
              maxLength={160}
              {...bind('invoiceTypeName')}
            />
            <Field label="Bên bán" maxLength={255} {...bind('sellerName')} />
            <Field
              label="MST bên bán"
              placeholder="0101234567"
              maxLength={64}
              {...bind('sellerTaxId')}
            />
            <Field label="Bên mua" maxLength={255} {...bind('buyerName')} />
            <Field
              label="MST bên mua"
              placeholder="0107654321"
              maxLength={64}
              {...bind('buyerTaxId')}
            />
            <Field label="Tiền tệ" placeholder="VND" maxLength={3} {...bind('currency')} />
            <Field
              label="Tổng tiền"
              inputMode="decimal"
              placeholder="1650000"
              {...bind('amount')}
            />
            <Field
              label="Tiền trước thuế (không bắt buộc)"
              inputMode="decimal"
              placeholder="1500000"
              {...bind('subtotalAmount')}
            />
            <Field
              label="Tiền thuế (không bắt buộc)"
              inputMode="decimal"
              placeholder="150000"
              {...bind('taxAmount')}
            />
            <Field label="Ngày phát hành" type="date" {...bind('issueDate')} />
            <Field label="Hạn thanh toán (không bắt buộc)" type="date" {...bind('dueDate')} />
          </div>
          {submitError && (
            <div className="mt-4">
              <ErrorBanner message={submitError} />
            </div>
          )}
          {Object.keys(errors).length > 0 && !submitError && (
            <div className="mt-4">
              <Notice tone="warning">Vui lòng sửa các trường được đánh dấu trước khi gửi.</Notice>
            </div>
          )}
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <GhostButton onClick={onClose} disabled={busy} className="min-h-12 justify-center px-5">
              Huỷ
            </GhostButton>
            <PrimaryButton type="submit" disabled={busy}>
              {busy && <Spinner />}
              {busy ? 'Đang tạo…' : 'Tạo hoá đơn'}
            </PrimaryButton>
          </div>
        </div>
      </form>
    </div>
  );
}
