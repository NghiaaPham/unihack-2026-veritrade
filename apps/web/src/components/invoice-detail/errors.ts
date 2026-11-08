import { ApiError } from '@/lib/api';

export const CHAIN_NOT_CONFIGURED_CODES = [
  'BLOCKCHAIN_NOT_CONFIGURED',
  'BLOCKCHAIN_SIGNER_NOT_CONFIGURED',
];

export function isChainNotConfigured(error: unknown): boolean {
  return error instanceof ApiError && CHAIN_NOT_CONFIGURED_CODES.includes(error.code);
}

/** Vietnamese message for an API failure; unknown errors fall back to the server text. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : 'Đã xảy ra lỗi không xác định.';
  }
  if (error.status === 0) return 'Không kết nối được tới máy chủ API. Kiểm tra mạng rồi thử lại.';
  if (isChainNotConfigured(error)) {
    return 'Blockchain chưa được cấu hình trên máy chủ nên chưa thể gửi giao dịch.';
  }
  switch (error.code) {
    case 'INVOICE_NOT_VERIFIED':
      return 'Hoá đơn cần kết quả xác minh Đạt hoặc Đã xác minh cục bộ trước khi neo hoặc yêu cầu tài trợ.';
    case 'INVALID_FINANCING_STATE':
      return 'Trạng thái yêu cầu tài trợ không cho phép thao tác này. Hãy tải lại trang để xem trạng thái mới nhất.';
    case 'BLOCKCHAIN_OPERATION_FAILED':
      return 'Giao dịch on-chain thất bại. Xem tab “Giao dịch on-chain” để biết chi tiết.';
    case 'BLOCKCHAIN_RATE_LIMITED':
      return 'Bạn gửi quá nhiều giao dịch trong thời gian ngắn. Vui lòng thử lại sau ít phút.';
    case 'BLOCKCHAIN_PENDING_LIMIT_REACHED':
      return 'Tổ chức đang có quá nhiều giao dịch chờ xác nhận. Vui lòng thử lại sau khoảng 30 giây.';
    case 'REQUESTED_AMOUNT_EXCEEDS_INVOICE':
      return 'Số tiền yêu cầu không được vượt quá giá trị hoá đơn.';
    default:
  }
  if (error.status === 429) return 'Quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.';
  if (error.status === 403)
    return 'Vai trò hiện tại của bạn không có quyền thực hiện thao tác này.';
  if (error.status === 404)
    return 'Không tìm thấy tài nguyên hoặc máy chủ chưa hỗ trợ chức năng này.';
  return error.message;
}
