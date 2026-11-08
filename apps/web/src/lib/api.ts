import type {
  AnchorStatusResponse,
  ApiErrorBody,
  AuthResult,
  BlockchainOperationResponse,
  FinancingClaimResponse,
  FinancingRequestListResponse,
  FinancingRequestResponse,
  FinancingStatus,
  InvoiceDetailResponse,
  InvoiceHistoryResponse,
  InvoiceListResponse,
  InvoiceStatus,
  VerificationResponse,
} from './types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const TOKEN_KEY = 'veritrade.session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

export function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { accessToken?: unknown };
    return typeof parsed.accessToken === 'string' ? parsed.accessToken : null;
  } catch {
    return null;
  }
}

export const SESSION_STORAGE_KEY = TOKEN_KEY;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = readStoredToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Không kết nối được tới máy chủ API.');
  }

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (isErrorBody(body)) {
      throw new ApiError(response.status, body.code ?? 'ERROR', body.message, body.details);
    }
    throw new ApiError(response.status, 'ERROR', `Yêu cầu thất bại (${response.status}).`);
  }
  return body as T;
}

export interface InvoiceListQuery {
  status?: InvoiceStatus;
  invoiceNumber?: string;
  sortBy?: 'createdAt' | 'issueDate' | 'amount';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const api = {
  login: (body: { email: string; password: string; organizationSlug?: string }) =>
    request<AuthResult>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  register: (body: {
    email: string;
    displayName: string;
    password: string;
    organizationName: string;
    organizationCountry: string;
  }) => request<AuthResult>('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(body) }),

  listInvoices: (q: InvoiceListQuery = {}) =>
    request<InvoiceListResponse>(`/api/v1/invoices${query({ ...q })}`),

  getInvoice: (id: string) => request<InvoiceDetailResponse>(`/api/v1/invoices/${id}`),

  getVerification: (id: string) =>
    request<VerificationResponse | null>(`/api/v1/invoices/${id}/verification`),

  getHistory: (id: string) => request<InvoiceHistoryResponse>(`/api/v1/invoices/${id}/history`),

  verify: (id: string) =>
    request<VerificationResponse>(`/api/v1/invoices/${id}/verify`, { method: 'POST' }),

  uploadInvoice: (file: File, dueDate?: string) => {
    const form = new FormData();
    form.set('file', file);
    if (dueDate) form.set('dueDate', dueDate);
    return request<InvoiceDetailResponse>('/api/v1/invoices/upload', { method: 'POST', body: form });
  },

  anchor: (id: string) =>
    request<BlockchainOperationResponse>(`/api/v1/invoices/${id}/anchor`, { method: 'POST' }),

  anchorStatus: (id: string) =>
    request<AnchorStatusResponse>(`/api/v1/invoices/${id}/anchor-status`),

  transaction: (operationId: string) =>
    request<BlockchainOperationResponse>(`/api/v1/blockchain/transactions/${operationId}`),

  financing: (
    requestId: string,
    action: 'reserve' | 'declare-financed' | 'close' | 'cancel-reservation',
  ) =>
    request<FinancingClaimResponse>(`/api/v1/financing-requests/${requestId}/${action}`, {
      method: 'POST',
    }),

  listFinancingRequests: (
    q: { status?: FinancingStatus; invoiceId?: string; limit?: number; offset?: number } = {},
  ) => request<FinancingRequestListResponse>(`/api/v1/financing-requests${query({ ...q })}`),

  getFinancingRequest: (id: string) =>
    request<FinancingRequestResponse>(`/api/v1/financing-requests/${id}`),

  createFinancingRequest: (body: {
    invoiceId: string;
    requestedAmount: string;
    termDays: number;
    interestRateBps: number;
    purpose: string;
  }) =>
    request<FinancingRequestResponse>('/api/v1/financing-requests', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
