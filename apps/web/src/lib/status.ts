import type {
  ClaimStatus,
  FinancingStatus,
  InvoiceStatus,
  OperationKind,
  OperationStatus,
  VerificationCheckStatus,
  VerificationStatus,
} from './types';

/** Colour family of a status pill; see TONES in components/ui/tone.ts. */
export type Tone = 'primary' | 'success' | 'warning' | 'error' | 'neutral';

interface Label {
  label: string;
  tone: Tone;
}

export const INVOICE_STATUS: Record<InvoiceStatus, Label> = {
  DRAFT: { label: 'Nháp', tone: 'neutral' },
  SUBMITTED: { label: 'Đã nộp', tone: 'primary' },
  UNDER_REVIEW: { label: 'Đang xét duyệt', tone: 'warning' },
  VERIFIED: { label: 'Đã xác minh', tone: 'success' },
  REJECTED: { label: 'Bị từ chối', tone: 'error' },
  FINANCING_REQUESTED: { label: 'Chờ tài trợ', tone: 'warning' },
  // The contract records a financier's declaration, never a payment.
  FINANCED: { label: 'Đã xác nhận tài trợ', tone: 'success' },
  SETTLED: { label: 'Đã tất toán', tone: 'neutral' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
};

export const VERIFICATION_STATUS: Record<VerificationStatus, Label> = {
  PENDING: { label: 'Đang chờ', tone: 'neutral' },
  PASSED: { label: 'Đạt', tone: 'success' },
  // PARTIAL is the normal "verified" outcome: the tax-authority check has no integration.
  PARTIAL: { label: 'Đã xác minh cục bộ', tone: 'primary' },
  FAILED: { label: 'Không đạt', tone: 'error' },
};

export const CHECK_STATUS: Record<VerificationCheckStatus, Label> = {
  PASSED: { label: 'Đạt', tone: 'success' },
  FAILED: { label: 'Không đạt', tone: 'error' },
  SKIPPED: { label: 'Bỏ qua', tone: 'neutral' },
  UNSUPPORTED: { label: 'Chưa hỗ trợ', tone: 'neutral' },
  NOT_CHECKED: { label: 'Chưa kiểm tra', tone: 'neutral' },
  ERROR: { label: 'Lỗi', tone: 'error' },
};

export const CHECK_LABEL: Record<string, string> = {
  'xml.structure': 'Cấu trúc XML',
  'fields.required': 'Trường bắt buộc',
  'arithmetic.totals': 'Khớp tổng tiền',
  'duplicate.detection': 'Phát hiện trùng lặp',
  'signature.xmldsig': 'Chữ ký số XML',
  'signature.trust': 'Độ tin cậy chứng thư số',
  'authority.tax': 'Đối chiếu cơ quan thuế',
};

export const FINANCING_STATUS: Record<FinancingStatus, Label> = {
  REQUESTED: { label: 'Đã yêu cầu', tone: 'primary' },
  RESERVED: { label: 'Đã giữ chỗ', tone: 'warning' },
  UNDER_REVIEW: { label: 'Đang thẩm định', tone: 'warning' },
  APPROVED: { label: 'Đã duyệt', tone: 'primary' },
  REJECTED: { label: 'Từ chối', tone: 'error' },
  FINANCING_DECLARED: { label: 'Đã xác nhận tài trợ', tone: 'success' },
  FUNDED: { label: 'Đã giải ngân', tone: 'success' },
  REPAID: { label: 'Đã hoàn trả', tone: 'neutral' },
  CLOSED: { label: 'Đã đóng', tone: 'neutral' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
};

export const OPERATION_STATUS: Record<OperationStatus, Label> = {
  PENDING: { label: 'Chờ gửi', tone: 'neutral' },
  SUBMITTING: { label: 'Đang gửi', tone: 'warning' },
  SUBMITTED: { label: 'Đã gửi', tone: 'warning' },
  CONFIRMED: { label: 'Đã xác nhận', tone: 'success' },
  FAILED: { label: 'Thất bại', tone: 'error' },
  UNKNOWN: { label: 'Đang đối soát', tone: 'warning' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
};

export const OPERATION_KIND: Record<OperationKind, string> = {
  INVOICE_ANCHOR: 'Neo & giữ chỗ hoá đơn',
  RESERVATION_CANCEL: 'Huỷ giữ chỗ',
  FINANCING_DECLARE: 'Xác nhận tài trợ',
  FINANCING_CLOSE: 'Đóng claim',
};

export const CLAIM_STATUS: Record<ClaimStatus, Label> = {
  UNREGISTERED: { label: 'Chưa đăng ký', tone: 'neutral' },
  RESERVED: { label: 'Đã giữ chỗ', tone: 'warning' },
  FINANCED: { label: 'Đã xác nhận tài trợ', tone: 'success' },
  CLOSED: { label: 'Đã đóng', tone: 'neutral' },
};

export const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Chủ sở hữu',
  ADMIN: 'Quản trị viên',
  MEMBER: 'Thành viên',
  VIEWER: 'Chỉ xem',
};

/** Share of checks that passed, for the "mức sẵn sàng" bar. Null when there are none. */
export function readiness(checks: { status: VerificationCheckStatus }[]): number | null {
  if (checks.length === 0) return null;
  const passed = checks.filter((c) => c.status === 'PASSED').length;
  return Math.round((passed / checks.length) * 100);
}
