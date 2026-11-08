import { FieldLabel, Panel, SectionLabel, StatusPill, TablePill } from '@/components/ui';
import { explorerTx } from '@/lib/chain';
import { formatDateTime, shortHash } from '@/lib/format';
import { FINANCING_STATUS, OPERATION_KIND, OPERATION_STATUS, type Tone } from '@/lib/status';
import type { BlockchainOperationResponse, FinancingStatus, OperationKind } from '@/lib/types';
import { toneRgb } from './format';

interface Step {
  title: string;
  description: string;
  tone: Tone;
  kind?: OperationKind;
}

const STEPS: [Step, ...Step[]] = [
  {
    title: 'Yêu cầu tạo',
    description: 'Bên bán gửi yêu cầu tài trợ cho hoá đơn đã xác minh.',
    tone: 'primary',
  },
  {
    title: 'Đã giữ chỗ',
    description: 'Mã cam kết của hoá đơn được ghi vào contract (RESERVED).',
    tone: 'warning',
    kind: 'INVOICE_ANCHOR',
  },
  {
    title: 'Đã xác nhận tài trợ',
    description: 'Bên tài trợ khai báo đã đồng ý tài trợ; chưa phải bằng chứng đã chuyển tiền.',
    tone: 'success',
    kind: 'FINANCING_DECLARE',
  },
  {
    title: 'Đã đóng',
    description: 'Claim kết thúc, không thể giữ chỗ hay tài trợ lại.',
    tone: 'neutral',
    kind: 'FINANCING_CLOSE',
  },
];

function reachedIndex(status: FinancingStatus): number {
  switch (status) {
    case 'RESERVED':
      return 1;
    case 'FINANCING_DECLARED':
    case 'FUNDED':
    case 'REPAID':
      return 2;
    case 'CLOSED':
      return 3;
    default:
      return 0;
  }
}

function Dot({ state, tone }: { state: 'done' | 'current' | 'pending'; tone: Tone }) {
  const color = toneRgb(tone);
  if (state === 'done') {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        style={{ background: color }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5">
          <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        style={{ background: toneRgb(tone, 0.12), border: `2px solid ${color}` }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      </span>
    );
  }
  return (
    <span
      className="h-5 w-5 shrink-0 rounded-full bg-surface"
      style={{ border: '2px solid var(--color-line-strong)' }}
    />
  );
}

export function StatusTimeline({
  status,
  createdAt,
  operation,
}: {
  status: FinancingStatus;
  createdAt: string;
  operation: BlockchainOperationResponse | null;
}) {
  const terminalOff = status === 'CANCELLED' || status === 'REJECTED';
  const steps: Step[] = terminalOff
    ? [
        STEPS[0],
        {
          title: FINANCING_STATUS[status].label,
          description:
            status === 'CANCELLED'
              ? 'Yêu cầu hoặc giữ chỗ đã bị huỷ; hoá đơn có thể được giữ chỗ lại.'
              : 'Yêu cầu bị từ chối.',
          tone: FINANCING_STATUS[status].tone,
        },
      ]
    : STEPS;
  const reached = terminalOff ? 1 : reachedIndex(status);
  const finished = status === 'CLOSED';
  const txUrl = operation?.txHash ? explorerTx(operation.txHash) : null;
  const opStatus = operation ? OPERATION_STATUS[operation.status] : null;

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Tiến trình claim</SectionLabel>
        <StatusPill tone={FINANCING_STATUS[status].tone}>
          {FINANCING_STATUS[status].label}
        </StatusPill>
      </div>

      <ol className="m-0 mt-5 list-none p-0">
        {steps.map((step, i) => {
          const state =
            i < reached || (i === reached && finished)
              ? 'done'
              : i === reached
                ? 'current'
                : 'pending';
          const last = i === steps.length - 1;
          const stamp =
            i === 0
              ? createdAt
              : operation && operation.kind === step.kind && operation.status === 'CONFIRMED'
                ? operation.confirmedAt
                : null;
          return (
            <li key={step.title} className="flex gap-4">
              <div className="flex flex-col items-center">
                <Dot state={state} tone={step.tone} />
                {!last && (
                  <span
                    className="my-1 w-0.5 flex-1 rounded-full"
                    style={{
                      background: i < reached ? toneRgb(step.tone, 0.5) : 'var(--color-line)',
                    }}
                  />
                )}
              </div>
              <div className={last ? 'min-w-0 flex-1' : 'min-w-0 flex-1 pb-6'}>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="text-sm font-bold"
                    style={{ color: state === 'pending' ? 'var(--color-lo)' : 'var(--color-ink)' }}
                  >
                    {step.title}
                  </span>
                  {state === 'current' && <StatusPill tone={step.tone}>Hiện tại</StatusPill>}
                </div>
                <p className="m-0 pt-0.5 text-xs leading-relaxed text-muted">{step.description}</p>
                {stamp && (
                  <p className="m-0 pt-1 text-[11px] font-medium text-lo">
                    {formatDateTime(stamp)}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 border-t border-line pt-5">
        <FieldLabel>Giao dịch on-chain gần nhất</FieldLabel>
        {operation && opStatus ? (
          <div className="mt-2 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">
                {OPERATION_KIND[operation.kind]}
              </span>
              <TablePill tone={opStatus.tone}>{opStatus.label}</TablePill>
            </div>
            {operation.txHash ? (
              <div className="break-all text-xs text-muted">
                {txUrl ? (
                  <a
                    href={txUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-primary no-underline hover:underline"
                    title={operation.txHash}
                  >
                    {shortHash(operation.txHash, 10, 8)} ↗
                  </a>
                ) : (
                  <span className="font-mono">{operation.txHash}</span>
                )}
              </div>
            ) : (
              <span className="text-xs text-muted">Chưa có mã giao dịch.</span>
            )}
          </div>
        ) : (
          <p className="m-0 mt-2 text-xs text-muted">
            Chưa có giao dịch on-chain nào được ghi nhận.
          </p>
        )}
      </div>

      <p className="m-0 mt-5 rounded-xl bg-surface2 px-4 py-3 text-[11px] leading-relaxed text-muted">
        “Đã xác nhận tài trợ” là lời khai của bên tài trợ được ghi trên contract. Contract không giữ
        tiền và không thấy chuyển khoản ngân hàng, nên trạng thái này không có nghĩa tiền đã được
        giải ngân.
      </p>
    </Panel>
  );
}
