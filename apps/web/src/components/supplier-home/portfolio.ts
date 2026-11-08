import { api } from '@/lib/api';
import type { Tone } from '@/lib/status';
import type {
  FinancingRequestResponse,
  FinancingStatus,
  InvoiceResponse,
  VerificationResponse,
} from '@/lib/types';
import { mapPool } from '@/components/verification/pool';

/**
 * Where an invoice really is in the flow.
 *
 * `invoice.status` cannot answer this: the API leaves it at SUBMITTED after
 * upload and never moves it on verification or financing. The stage is
 * derived from the latest verification run and the invoice's financing request.
 */
export type Stage = 'FAILED' | 'SUBMITTED' | 'VERIFIED' | 'REQUESTED' | 'RESERVED' | 'DECLARED' | 'CLOSED';

export const STAGE_META: Record<Stage, { label: string; tone: Tone; percent: number }> = {
  FAILED: { label: 'Xác minh không đạt', tone: 'error', percent: 20 },
  SUBMITTED: { label: 'Đã nộp', tone: 'neutral', percent: 20 },
  VERIFIED: { label: 'Đã xác minh', tone: 'primary', percent: 40 },
  REQUESTED: { label: 'Chờ tài trợ', tone: 'warning', percent: 60 },
  RESERVED: { label: 'Đã giữ chỗ', tone: 'warning', percent: 80 },
  DECLARED: { label: 'Đã xác nhận tài trợ', tone: 'success', percent: 100 },
  CLOSED: { label: 'Đã đóng claim', tone: 'neutral', percent: 100 },
};

const REQUEST_STAGE: Partial<Record<FinancingStatus, Stage>> = {
  REQUESTED: 'REQUESTED',
  UNDER_REVIEW: 'REQUESTED',
  APPROVED: 'REQUESTED',
  RESERVED: 'RESERVED',
  FINANCING_DECLARED: 'DECLARED',
  FUNDED: 'DECLARED',
  REPAID: 'CLOSED',
  CLOSED: 'CLOSED',
};

export interface PortfolioItem {
  invoice: InvoiceResponse;
  verification: VerificationResponse | null;
  request: FinancingRequestResponse | null;
  stage: Stage;
}

export function stageOf(
  verification: VerificationResponse | null,
  request: FinancingRequestResponse | null,
): Stage {
  const fromRequest = request ? REQUEST_STAGE[request.status] : undefined;
  if (fromRequest) return fromRequest;
  if (verification?.status === 'FAILED') return 'FAILED';
  if (verification?.status === 'PASSED' || verification?.status === 'PARTIAL') return 'VERIFIED';
  return 'SUBMITTED';
}

const PORTFOLIO_LIMIT = 100;

/** Latest 100 invoices with their verification and newest financing request. */
export async function loadPortfolio(): Promise<{ items: PortfolioItem[]; total: number }> {
  const [invoices, requests] = await Promise.all([
    api.listInvoices({ limit: PORTFOLIO_LIMIT, sortBy: 'createdAt', sortOrder: 'desc' }),
    api.listFinancingRequests({ limit: PORTFOLIO_LIMIT }).catch(() => null),
  ]);

  // Requests arrive newest first, so the first one seen per invoice is the latest.
  const requestByInvoice = new Map<string, FinancingRequestResponse>();
  for (const r of requests?.items ?? []) {
    if (!requestByInvoice.has(r.invoiceId)) requestByInvoice.set(r.invoiceId, r);
  }

  const verifications = await mapPool(invoices.items, 5, (inv) =>
    api.getVerification(inv.id).catch(() => null),
  );

  const items = invoices.items.map((invoice, i) => {
    const verification = verifications[i] ?? null;
    const request = requestByInvoice.get(invoice.id) ?? null;
    return { invoice, verification, request, stage: stageOf(verification, request) };
  });
  return { items, total: invoices.pagination.total };
}

export function countStages(items: PortfolioItem[], stages: Stage[]): number {
  return items.filter((item) => stages.includes(item.stage)).length;
}
