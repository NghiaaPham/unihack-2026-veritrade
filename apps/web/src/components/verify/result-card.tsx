import { FieldGrid, StatusPill, TopStripPanel, SectionLabel } from '@/components/ui';
import { chainName, explorerAddress } from '@/lib/chain';
import { formatDateTime } from '@/lib/format';
import { CLAIM_STATUS } from '@/lib/status';
import type { ClaimStatus } from '@/lib/types';
import { registryAddress, type RegistryLookup } from './registry';

const HEADLINE: Record<ClaimStatus, string> = {
  UNREGISTERED: 'Chưa có claim đang hoạt động',
  RESERVED: 'Đã có bên giữ chỗ',
  FINANCED: 'Đã có bên xác nhận tài trợ',
  CLOSED: 'Claim đã đóng',
};

function explanation(result: RegistryLookup): string {
  switch (result.status) {
    case 'UNREGISTERED':
      return result.generation > 0
        ? `Chưa ai giữ chỗ hoá đơn này — có thể tài trợ. Mã cam kết từng được giữ chỗ ${result.generation} lần và đã được huỷ; contract không phân biệt “chưa từng thấy” với “đã huỷ giữ chỗ” ngoài bộ đếm này.`
        : 'Chưa ai giữ chỗ hoá đơn này — có thể tài trợ. Contract không phân biệt “chưa từng thấy” với “đã huỷ giữ chỗ”.';
    case 'RESERVED':
      return 'Đã có bên giữ chỗ hoá đơn này. Lần giữ chỗ hoặc tài trợ của bên khác sẽ bị contract từ chối.';
    case 'FINANCED':
      return 'Đã có bên xác nhận tài trợ hoá đơn này — không thể tài trợ lần nữa. Đây là lời khai của bên tài trợ; contract không thấy chuyển khoản ngân hàng.';
    case 'CLOSED':
      return 'Claim đã được tài trợ rồi đóng. Đây là trạng thái cuối: hoá đơn không thể được giữ chỗ hay tài trợ lại.';
  }
}

const unix = (seconds: number) =>
  seconds > 0 ? formatDateTime(new Date(seconds * 1000).toISOString()) : null;

export function ResultCard({ result }: { result: RegistryLookup }) {
  const status = CLAIM_STATUS[result.status];
  const addressUrl = registryAddress ? explorerAddress(registryAddress) : null;
  const fields = [
    {
      label: 'Mã cam kết',
      wide: true,
      value: <span className="font-mono text-xs">{result.commitment}</span>,
    },
    {
      label: 'Hợp đồng registry',
      wide: true,
      value: addressUrl ? (
        <a
          href={addressUrl}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-primary no-underline hover:underline"
        >
          {registryAddress} ↗
        </a>
      ) : (
        <span className="font-mono text-xs">{registryAddress}</span>
      ),
    },
    { label: 'Mạng', value: chainName() },
    ...(result.generation > 0
      ? [{ label: 'Số lần giữ chỗ', value: String(result.generation) }]
      : []),
    ...(unix(result.reservedAt) ? [{ label: 'Giữ chỗ lúc', value: unix(result.reservedAt) }] : []),
    ...(unix(result.financedAt)
      ? [{ label: 'Xác nhận tài trợ lúc', value: unix(result.financedAt) }]
      : []),
    ...(unix(result.closedAt) ? [{ label: 'Đóng lúc', value: unix(result.closedAt) }] : []),
  ];

  return (
    <TopStripPanel tone={status.tone}>
      <div className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel tone={status.tone}>Kết quả tra cứu</SectionLabel>
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        </div>
        <h2 className="m-0 pt-2 text-[22px] font-bold leading-tight tracking-[-0.4px] text-ink">
          {HEADLINE[result.status]}
        </h2>
        <p className="m-0 max-w-2xl pt-2 text-sm leading-relaxed text-muted">
          {explanation(result)}
        </p>
        <div className="mt-5 border-t border-line pt-5">
          <FieldGrid fields={fields} />
        </div>
      </div>
    </TopStripPanel>
  );
}
