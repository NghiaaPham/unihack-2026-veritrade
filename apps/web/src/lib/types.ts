/**
 * Response shapes of the VeriTrade API, mirrored from the presenters in
 * apps/api/src (invoice.presenter.ts, verification.presenter.ts,
 * blockchain.presenter.ts, auth.service.ts). Money and wei stay strings.
 */

export type MembershipRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export type InvoiceStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'REJECTED'
  | 'FINANCING_REQUESTED'
  | 'FINANCED'
  | 'SETTLED'
  | 'CANCELLED';

export type VerificationStatus = 'PENDING' | 'PASSED' | 'PARTIAL' | 'FAILED';

export type VerificationCheckStatus =
  'PASSED' | 'FAILED' | 'SKIPPED' | 'UNSUPPORTED' | 'NOT_CHECKED' | 'ERROR';

export type FinancingStatus =
  | 'REQUESTED'
  | 'RESERVED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'FINANCING_DECLARED'
  | 'FUNDED'
  | 'REPAID'
  | 'CLOSED'
  | 'CANCELLED';

export type OperationKind =
  'INVOICE_ANCHOR' | 'RESERVATION_CANCEL' | 'FINANCING_DECLARE' | 'FINANCING_CLOSE';

export type OperationStatus =
  'PENDING' | 'SUBMITTING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';

export type ClaimStatus = 'UNREGISTERED' | 'RESERVED' | 'FINANCED' | 'CLOSED';

export interface AuthResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: { id: string; email: string; displayName: string };
  organization: { id: string; name: string; slug: string };
  role: MembershipRole;
}

export interface DocumentResponse {
  filename: string;
  mimeType: string;
  byteSize: number;
  format: string;
  parserVersion: string;
  createdAt: string;
}

export interface InvoiceResponse {
  id: string;
  organizationId: string;
  status: InvoiceStatus;
  invoiceSeries: string;
  invoiceNumber: string;
  invoiceType: string;
  invoiceTypeName: string | null;
  sellerName: string;
  sellerTaxId: string;
  buyerName: string;
  buyerTaxId: string;
  currency: string;
  amount: string;
  subtotalAmount: string | null;
  taxAmount: string | null;
  issueDate: string;
  dueDate: string | null;
  fingerprint: string;
  contentHash: string;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  document: DocumentResponse | null;
}

export interface VerificationCheckResponse {
  key: string;
  label: string;
  status: VerificationCheckStatus;
  message: string;
  details: Record<string, unknown> | null;
  durationMs: number;
}

export interface VerificationResponse {
  id: string;
  status: VerificationStatus;
  scope: 'LOCAL_CHECKS_ONLY';
  provider: string;
  score: number | null;
  checkedAt: string | null;
  createdAt: string;
  limitations: string[];
  checks: VerificationCheckResponse[];
}

export interface InvoiceDetailResponse extends InvoiceResponse {
  verification: VerificationResponse | null;
}

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
}

export interface InvoiceListResponse {
  items: InvoiceResponse[];
  pagination: Pagination;
}

export interface InvoiceHistoryEvent {
  action: string;
  actorUserId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface InvoiceHistoryResponse {
  invoiceId: string;
  verifications: VerificationResponse[];
  events: InvoiceHistoryEvent[];
}

export interface BlockchainReceiptResponse {
  chainId: number;
  txHash: string;
  blockNumber: number;
  blockHash: string;
  status: 'SUCCESS' | 'REVERTED';
  gasUsed: string;
  effectiveGasPrice: string;
  logCount: number;
  observedAt: string;
}

export interface BlockchainOperationResponse {
  id: string;
  kind: OperationKind;
  status: OperationStatus;
  chainId: number;
  contractAddress: string;
  commitment: string;
  entityId: string | null;
  financingRef: string | null;
  invoiceId: string | null;
  financingRequestId: string | null;
  txHash: string | null;
  nonce: number | null;
  attemptCount: number;
  error: { code: string; message: string } | null;
  createdAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
  receipt: BlockchainReceiptResponse | null;
}

export interface AnchorStatusResponse {
  invoiceId: string;
  anchored: boolean;
  commitment: string | null;
  claimStatus: ClaimStatus | null;
  operation: BlockchainOperationResponse | null;
  checkedAt: string;
}

export interface FinancingClaimResponse {
  financingRequestId: string;
  status: FinancingStatus;
  operation: BlockchainOperationResponse | null;
}

/** GET/POST /api/v1/financing-requests (financing-requests module). */
export interface FinancingRequestResponse {
  id: string;
  organizationId: string;
  invoiceId: string;
  requestedById: string;
  requestedAmount: string;
  currency: string;
  status: FinancingStatus;
  termDays: number;
  /** Basis points; 850 = 8.50 %/year. */
  interestRateBps: number;
  purpose: string;
  createdAt: string;
  updatedAt: string;
  invoice: {
    id: string;
    invoiceSeries: string;
    invoiceNumber: string;
    sellerName: string;
    sellerTaxId: string;
    buyerName: string;
    amount: string;
    currency: string;
    issueDate: string;
    dueDate: string | null;
    status: InvoiceStatus;
  };
}

export interface FinancingRequestListResponse {
  items: FinancingRequestResponse[];
  pagination: Pagination;
}

/** The project error envelope (apps/api/src/common). */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  timestamp?: string;
  path?: string;
}
