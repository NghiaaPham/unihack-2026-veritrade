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

/*
 * Check messages and labels arrive in English from apps/api/src/invoice-verification/checks.
 * Known sentences are translated for display; anything new falls back to the API text.
 */
const CHECK_LABEL_EN: Record<string, string> = {
  'XML structural validity': CHECK_LABEL['xml.structure'] ?? '',
  'Required business fields': CHECK_LABEL['fields.required'] ?? '',
  'Financial arithmetic consistency': CHECK_LABEL['arithmetic.totals'] ?? '',
  'Duplicate invoice detection': CHECK_LABEL['duplicate.detection'] ?? '',
  'XML digital signature': CHECK_LABEL['signature.xmldsig'] ?? '',
  'Signature certificate trust chain': CHECK_LABEL['signature.trust'] ?? '',
  'Tax authority verification': CHECK_LABEL['authority.tax'] ?? '',
};

const CHECK_MESSAGE_VI: Record<string, string> = {
  'All required business fields are present': 'Có đủ các trường nghiệp vụ bắt buộc.',
  'The invoice is missing or has invalid business fields':
    'Hoá đơn thiếu hoặc sai trường nghiệp vụ bắt buộc.',
  'The invoice totals reconcile': 'Tổng tiền khớp (tạm tính + thuế = tổng cộng).',
  'The invoice totals do not reconcile': 'Tổng tiền không khớp.',
  'There was not enough monetary detail to check the arithmetic':
    'Không đủ dữ liệu tiền để kiểm tra phép tính.',
  'No duplicate of this invoice exists in the organisation':
    'Không có hoá đơn trùng trong tổ chức.',
  'More than one invoice shares this identity inside the organisation':
    'Có nhiều hoá đơn cùng định danh trong tổ chức.',
  'Another invoice in this organisation has identical content under a different identity':
    'Một hoá đơn khác trong tổ chức có nội dung giống hệt nhưng định danh khác.',
  'The invoice could not be found by its own fingerprint':
    'Không tìm thấy hoá đơn theo dấu vân tay của chính nó.',
  'The document carries no XML digital signature': 'Tài liệu không có chữ ký số XML.',
  'Every XML signature validates against its embedded certificate':
    'Mọi chữ ký số XML đều hợp lệ với chứng thư đính kèm.',
  'At least one XML signature does not match the document':
    'Có chữ ký số XML không khớp với tài liệu.',
  'At least one XML signature could not be processed': 'Có chữ ký số XML không xử lý được.',
  'The document could not be loaded for signature verification':
    'Không tải được tài liệu để kiểm tra chữ ký.',
  'The invoice has no source document, so there is no signature to verify':
    'Hoá đơn không có tệp gốc nên không có chữ ký để kiểm tra.',
  'No certificate trust store or revocation source is configured, so the signing certificate is not validated against a CA':
    'Chưa cấu hình kho chứng thư tin cậy hay nguồn thu hồi, nên chứng thư ký chưa được đối chiếu với CA.',
  'The signature does not embed an X.509 certificate and no external trust anchor is configured':
    'Chữ ký không kèm chứng thư X.509 và chưa cấu hình mốc tin cậy bên ngoài.',
  'No authorized tax-authority integration is configured; the invoice has not been confirmed by the tax authority':
    'Chưa tích hợp với cơ quan thuế; hoá đơn chưa được cơ quan thuế xác nhận.',
  'The document could not be parsed': 'Không phân tích được tài liệu.',
  'The document was supplied but never parsed; this is a service defect':
    'Tài liệu đã được gửi nhưng chưa được phân tích (lỗi dịch vụ).',
  'The invoice was created from structured metadata and has no source document to parse':
    'Hoá đơn được nhập thủ công, không có tệp gốc để phân tích.',
  'The check could not be completed': 'Không hoàn tất được bước kiểm tra.',
};

export function checkMessage(text: string): string {
  const known = CHECK_MESSAGE_VI[text];
  if (known) return known;
  const parsed = /^Document parsed as (.+)$/.exec(text);
  if (parsed) return `Đã phân tích tài liệu theo định dạng ${parsed[1]}.`;
  const tooMany = /^The document contains more than (\d+) signatures/.exec(text);
  if (tooMany) return `Tài liệu có hơn ${tooMany[1]} chữ ký — chưa hỗ trợ.`;
  return text;
}

/** Limitations are "<English label>: <message>" (verification-engine.service.ts). */
export function limitationText(text: string): string {
  const sep = text.indexOf(': ');
  if (sep < 0) return checkMessage(text);
  const label = CHECK_LABEL_EN[text.slice(0, sep)] || text.slice(0, sep);
  return `${label}: ${checkMessage(text.slice(sep + 2))}`;
}
