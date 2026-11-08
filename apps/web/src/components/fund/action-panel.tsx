'use client';

import { useState } from 'react';
import {
  MetricStrip,
  Notice,
  Panel,
  SectionLabel,
  Segmented,
  SmallButton,
  Spinner,
} from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { FINANCING_STATUS } from '@/lib/status';
import type { FinancingRequestResponse } from '@/lib/types';
import { ALLOWED_STATES, defaultAction, formatRateBps, type ClaimAction } from './format';

interface ActionCopy {
  segment: string;
  title: string;
  description: string;
  precondition: string;
  button: string;
}

const COPY: Record<ClaimAction, ActionCopy> = {
  reserve: {
    segment: 'Giữ chỗ',
    title: 'Giữ chỗ claim trên Avalanche',
    description:
      'Ghi mã cam kết của hoá đơn vào contract với trạng thái RESERVED. Từ lúc này, contract từ chối mọi lần giữ chỗ hoặc tài trợ khác cho cùng hoá đơn.',
    precondition:
      'Khả dụng khi yêu cầu ở trạng thái Đã yêu cầu, Đang thẩm định, Đã duyệt hoặc Đã giữ chỗ, và hoá đơn đã được xác minh.',
    button: 'Giữ chỗ claim',
  },
  'declare-financed': {
    segment: 'Xác nhận tài trợ',
    title: 'Xác nhận tài trợ',
    description:
      'Khai báo trên contract rằng bên tài trợ đã đồng ý tài trợ hoá đơn này (FINANCED). Đây là lời khai của bên tài trợ, không phải bằng chứng đã chuyển tiền — contract không nhìn thấy giao dịch ngân hàng.',
    precondition: 'Chỉ khả dụng khi yêu cầu đã được giữ chỗ.',
    button: 'Xác nhận tài trợ',
  },
  close: {
    segment: 'Đóng claim',
    title: 'Đóng claim',
    description:
      'Kết thúc vòng đời của claim đã xác nhận tài trợ. Đây là trạng thái cuối: hoá đơn không thể được giữ chỗ hay tài trợ lại sau khi đóng.',
    precondition: 'Chỉ khả dụng khi yêu cầu đã xác nhận tài trợ.',
    button: 'Đóng claim',
  },
  'cancel-reservation': {
    segment: 'Huỷ giữ chỗ',
    title: 'Huỷ giữ chỗ',
    description:
      'Gỡ giữ chỗ khi chưa xác nhận tài trợ. Claim quay về chưa đăng ký và hoá đơn có thể được giữ chỗ lại; sự kiện huỷ vẫn được lưu trên chain.',
    precondition: 'Chỉ khả dụng khi yêu cầu đã được giữ chỗ nhưng chưa xác nhận tài trợ.',
    button: 'Huỷ giữ chỗ',
  },
};

const ORDER: ClaimAction[] = ['reserve', 'declare-financed', 'close', 'cancel-reservation'];

export function ActionPanel({
  request,
  busy,
  progress,
  error,
  onRun,
}: {
  request: FinancingRequestResponse;
  busy: ClaimAction | null;
  progress: string | null;
  error: string | null;
  onRun: (action: ClaimAction) => void;
}) {
  const [action, setAction] = useState<ClaimAction>(() => defaultAction(request.status));
  const copy = COPY[action];
  const allowed = ALLOWED_STATES[action].includes(request.status);
  const current = FINANCING_STATUS[request.status];

  return (
    <Panel>
      <SectionLabel>Giữ chỗ &amp; tài trợ</SectionLabel>
      <p className="m-0 pt-2 text-xs text-muted">
        Giữ chỗ, xác nhận hoặc đóng claim của hoá đơn này trên contract registry.
      </p>

      <div className="mt-5">
        <MetricStrip
          items={[
            {
              label: 'Số tiền yêu cầu',
              value: formatMoney(request.requestedAmount, request.currency),
              tone: 'primary',
            },
            { label: 'Lãi suất', value: formatRateBps(request.interestRateBps) },
            { label: 'Kỳ hạn', value: `${request.termDays} ngày` },
          ]}
        />
      </div>

      <div className="mt-5">
        <Segmented
          options={ORDER.map((a) => ({ value: a, label: COPY[a].segment }))}
          value={action}
          onChange={setAction}
        />
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
        <p className="m-0 text-sm font-bold text-ink">{copy.title}</p>
        <p className="m-0 pt-1 text-xs leading-relaxed text-muted">{copy.description}</p>
        <div className="mt-4">
          <Notice tone={allowed ? 'primary' : 'warning'}>
            {allowed
              ? copy.precondition
              : `${copy.precondition} Trạng thái hiện tại: ${current.label}.`}
          </Notice>
        </div>
        {progress && (
          <div
            className="mt-3 flex items-center gap-2 text-xs font-medium text-muted"
            role="status"
          >
            <Spinner />
            {progress}
          </div>
        )}
        {error && (
          <div className="mt-3" role="alert">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
        <SmallButton
          className="mt-4"
          disabled={!allowed || busy !== null}
          onClick={() => onRun(action)}
        >
          {busy === action ? (
            <>
              <Spinner />
              Đang xử lý…
            </>
          ) : (
            copy.button
          )}
        </SmallButton>
      </div>
    </Panel>
  );
}
