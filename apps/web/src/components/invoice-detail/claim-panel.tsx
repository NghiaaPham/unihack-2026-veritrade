'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  GhostButton,
  MetricStrip,
  Notice,
  Panel,
  PrimaryButton,
  SectionLabel,
  Segmented,
  Spinner,
} from '@/components/ui';
import { api } from '@/lib/api';
import { explorerTx } from '@/lib/chain';
import { shortHash } from '@/lib/format';
import {
  CLAIM_STATUS,
  FINANCING_STATUS,
  OPERATION_KIND,
  OPERATION_STATUS,
  VERIFICATION_STATUS,
  type Tone,
} from '@/lib/status';
import type {
  AnchorStatusResponse,
  BlockchainOperationResponse,
  FinancingRequestResponse,
  FinancingStatus,
  InvoiceDetailResponse,
  OperationStatus,
} from '@/lib/types';
import { isPositiveAmount, formatBps, parsePercentToBps } from './decimal';
import { describeError, isChainNotConfigured } from './errors';

type ClaimTab = 'anchor' | 'reserve' | 'declare' | 'close' | 'cancel';
type FinancingAction = 'reserve' | 'declare-financed' | 'close' | 'cancel-reservation';

const IN_FLIGHT: OperationStatus[] = ['PENDING', 'SUBMITTING', 'SUBMITTED', 'UNKNOWN'];
const TERMINAL_REQUEST: FinancingStatus[] = ['REJECTED', 'REPAID', 'CLOSED', 'CANCELLED'];
const RESERVABLE: FinancingStatus[] = ['REQUESTED', 'UNDER_REVIEW', 'APPROVED'];
const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_TICKS = 40;

export const isInFlight = (status: OperationStatus) => IN_FLIGHT.includes(status);

/** The request still moving through the lifecycle, if any. */
export function pickActiveRequest(items: FinancingRequestResponse[]): FinancingRequestResponse | null {
  return items.find((r) => !TERMINAL_REQUEST.includes(r.status)) ?? null;
}

interface ClaimPanelProps {
  invoice: InvoiceDetailResponse;
  anchor: AnchorStatusResponse | null;
  chainNotConfigured: boolean;
  requests: FinancingRequestResponse[];
  requestsUnavailable: boolean;
  canWrite: boolean;
  onOperation: (operation: BlockchainOperationResponse) => void;
  onRefresh: () => Promise<void>;
}

export function ClaimPanel({
  invoice,
  anchor,
  chainNotConfigured,
  requests,
  requestsUnavailable,
  canWrite,
  onOperation,
  onRefresh,
}: ClaimPanelProps) {
  const active = pickActiveRequest(requests);
  const claimStatus = anchor?.claimStatus ?? null;
  const verificationStatus = invoice.verification?.status ?? null;
  const verificationUsable = verificationStatus === 'PASSED' || verificationStatus === 'PARTIAL';

  const [tab, setTab] = useState<ClaimTab>(() => {
    if (active?.status === 'FINANCING_DECLARED') return 'close';
    if (active?.status === 'RESERVED') return 'declare';
    if (claimStatus === 'RESERVED' || claimStatus === 'FINANCED') return 'reserve';
    return 'anchor';
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localNotConfigured, setLocalNotConfigured] = useState(false);

  const [manualOpId, setManualOpId] = useState<string | null>(null);
  const [stoppedFor, setStoppedFor] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [liveOperation, setLiveOperation] = useState<BlockchainOperationResponse | null>(null);

  const anchorOp = anchor?.operation ?? null;
  const trackedId = manualOpId ?? (anchorOp && isInFlight(anchorOp.status) ? anchorOp.id : null);
  const pollId = trackedId !== null && trackedId !== stoppedFor ? trackedId : null;

  const callbacks = useRef({ onOperation, onRefresh });
  useEffect(() => {
    callbacks.current = { onOperation, onRefresh };
  });

  useEffect(() => {
    if (!pollId) return;
    let cancelled = false;
    let ticks = 0;
    const timer = setInterval(async () => {
      ticks += 1;
      try {
        const op = await api.transaction(pollId);
        if (cancelled) return;
        setLiveOperation(op);
        callbacks.current.onOperation(op);
        if (!isInFlight(op.status)) {
          clearInterval(timer);
          setStoppedFor(pollId);
          await callbacks.current.onRefresh();
          return;
        }
      } catch {
        // A transient read failure should not end polling; the tick cap does.
      }
      if (!cancelled && ticks >= POLL_MAX_TICKS) {
        clearInterval(timer);
        setStoppedFor(pollId);
        setTimedOut(true);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollId]);

  const progressOp = pollId
    ? liveOperation?.id === pollId
      ? liveOperation
      : anchorOp?.id === pollId
        ? anchorOp
        : null
    : null;

  async function run(key: string, call: () => Promise<BlockchainOperationResponse | null>) {
    setBusy(key);
    setError(null);
    setTimedOut(false);
    try {
      const op = await call();
      if (op) {
        onOperation(op);
        setLiveOperation(op);
        setStoppedFor(null);
        if (isInFlight(op.status)) setManualOpId(op.id);
      }
      await onRefresh();
    } catch (e) {
      if (isChainNotConfigured(e)) setLocalNotConfigured(true);
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  const financing = (action: FinancingAction) => () => {
    if (!active) return;
    void run(action, async () => (await api.financing(active.id, action)).operation);
  };

  const working = busy !== null || pollId !== null;
  const disabledBase = !canWrite || working || chainNotConfigured || localNotConfigured;

  const notConfigured = chainNotConfigured || localNotConfigured;
  const topNotice: { tone: Tone; text: string } = notConfigured
    ? { tone: 'warning', text: 'Blockchain chưa được cấu hình trên máy chủ — chưa thể gửi giao dịch on-chain.' }
    : !canWrite
      ? { tone: 'neutral', text: 'Vai trò Chỉ xem không được gửi giao dịch on-chain.' }
      : { tone: 'primary', text: 'Thao tác on-chain do máy chủ ký — bạn không cần ví.' };

  const claim = claimStatus ? CLAIM_STATUS[claimStatus] : null;
  const verification = verificationStatus ? VERIFICATION_STATUS[verificationStatus] : null;
  const financingLabel = active ? FINANCING_STATUS[active.status] : null;

  const anchored = claimStatus === 'RESERVED' || claimStatus === 'FINANCED' || claimStatus === 'CLOSED';

  return (
    <Panel>
      <SectionLabel>Quản lý claim</SectionLabel>
      <p className="m-0 pt-2 text-xs text-muted">
        Vòng đời claim trên chuỗi — neo, giữ chỗ, xác nhận tài trợ, đóng.
      </p>
      <div className="mt-4">
        <Notice tone={topNotice.tone}>{topNotice.text}</Notice>
      </div>

      <div className="mt-5">
        <MetricStrip
          items={[
            {
              label: 'Trạng thái claim',
              value: claim ? claim.label : '—',
              tone: claim && claimStatus !== 'UNREGISTERED' ? claim.tone : undefined,
            },
            {
              label: 'Xác minh',
              value: verification ? verification.label : '—',
              tone: verification?.tone,
            },
            {
              label: 'Yêu cầu tài trợ',
              value: financingLabel ? financingLabel.label : '—',
              tone: financingLabel?.tone,
            },
          ]}
        />
      </div>

      {progressOp && (
        <div className="mt-4">
          <Notice tone="warning">
            <span className="inline-flex items-center gap-2">
              <Spinner size={12} />
              Đang chờ xác nhận “{OPERATION_KIND[progressOp.kind]}” —{' '}
              {OPERATION_STATUS[progressOp.status].label}
              {progressOp.txHash ? ` · ${shortHash(progressOp.txHash)}` : ''}
            </span>
          </Notice>
        </div>
      )}
      {pollId && !progressOp && (
        <div className="mt-4">
          <Notice tone="warning">
            <span className="inline-flex items-center gap-2">
              <Spinner size={12} />
              Đang chờ xác nhận giao dịch on-chain…
            </span>
          </Notice>
        </div>
      )}
      {timedOut && (
        <div className="mt-4">
          <Notice tone="warning">
            Giao dịch chưa được xác nhận sau 2 phút. Hệ thống vẫn tiếp tục đối soát — hãy tải lại
            trang sau ít phút để xem kết quả.
          </Notice>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <div className="mt-5">
        <Segmented<ClaimTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'anchor', label: 'Neo on-chain' },
            { value: 'reserve', label: 'Giữ chỗ' },
            { value: 'declare', label: 'Xác nhận tài trợ' },
            { value: 'close', label: 'Đóng claim' },
            { value: 'cancel', label: 'Huỷ giữ chỗ' },
          ]}
        />
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
        {tab === 'anchor' && (
          <ActionCard
            title="Neo hoá đơn lên Avalanche"
            description="Ghi mã cam kết (hash) của hoá đơn lên hợp đồng đăng ký và giữ chỗ claim. Chỉ hash được công bố — không có dữ liệu hoá đơn. Mỗi hoá đơn chỉ được giữ chỗ bởi một tổ chức; lần đăng ký thứ hai sẽ bị từ chối."
            notice={
              anchored
                ? `Hoá đơn đã được neo — claim đang ở trạng thái “${CLAIM_STATUS[claimStatus ?? 'RESERVED'].label}”.`
                : !verificationUsable
                  ? 'Cần kết quả xác minh Đạt hoặc Đã xác minh cục bộ.'
                  : null
            }
            action={
              <PrimaryButton
                className="!min-h-11 !px-5 !text-xs"
                disabled={disabledBase || anchored || !verificationUsable}
                onClick={() => void run('anchor', () => api.anchor(invoice.id))}
              >
                {busy === 'anchor' && <Spinner />}
                Neo on-chain
              </PrimaryButton>
            }
          />
        )}

        {tab === 'reserve' && (
          <ReserveCard
            invoice={invoice}
            active={active}
            requestsUnavailable={requestsUnavailable}
            verificationUsable={verificationUsable}
            disabledBase={disabledBase}
            busy={busy === 'reserve'}
            onReserve={financing('reserve')}
            onCreated={onRefresh}
          />
        )}

        {tab === 'declare' && (
          <ActionCard
            title="Xác nhận tài trợ"
            description="Ghi lên chuỗi rằng bên tài trợ đã đồng ý tài trợ cho claim này. Đây chỉ là khai báo: hợp đồng không nhìn thấy giao dịch ngân hàng và hệ thống không xác nhận tiền đã được chuyển."
            notice={
              active?.status === 'RESERVED'
                ? null
                : 'Cần một yêu cầu tài trợ ở trạng thái Đã giữ chỗ.'
            }
            action={
              <PrimaryButton
                className="!min-h-11 !px-5 !text-xs"
                disabled={disabledBase || active?.status !== 'RESERVED'}
                onClick={financing('declare-financed')}
              >
                {busy === 'declare-financed' && <Spinner />}
                Xác nhận tài trợ
              </PrimaryButton>
            }
          />
        )}

        {tab === 'close' && (
          <ActionCard
            title="Đóng claim"
            description="Kết thúc claim đã được xác nhận tài trợ. Trạng thái Đã đóng là cuối cùng: hoá đơn không thể được đăng ký lại, nhằm chặn việc đưa hoá đơn đã tài trợ vào một claim mới."
            notice={
              active?.status === 'FINANCING_DECLARED'
                ? null
                : 'Cần một yêu cầu tài trợ ở trạng thái Đã xác nhận tài trợ.'
            }
            action={
              <PrimaryButton
                className="!min-h-11 !px-5 !text-xs"
                disabled={disabledBase || active?.status !== 'FINANCING_DECLARED'}
                onClick={financing('close')}
              >
                {busy === 'close' && <Spinner />}
                Đóng claim
              </PrimaryButton>
            }
          />
        )}

        {tab === 'cancel' && (
          <ActionCard
            title="Huỷ giữ chỗ"
            description="Nhả giữ chỗ chưa được tài trợ: claim trở về Chưa đăng ký và hoá đơn có thể được giữ chỗ lại. Claim đã xác nhận tài trợ không huỷ được mà phải đóng."
            notice={
              active?.status === 'RESERVED'
                ? null
                : 'Cần một yêu cầu tài trợ ở trạng thái Đã giữ chỗ.'
            }
            action={
              <GhostButton
                className="!min-h-11 !rounded-full !px-5"
                disabled={disabledBase || active?.status !== 'RESERVED'}
                onClick={financing('cancel-reservation')}
              >
                {busy === 'cancel-reservation' && <Spinner />}
                Huỷ giữ chỗ
              </GhostButton>
            }
          />
        )}
      </div>
    </Panel>
  );
}

function ActionCard({
  title,
  description,
  notice,
  action,
  children,
}: {
  title: string;
  description: string;
  notice: string | null;
  action: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div>
      <p className="m-0 text-sm font-bold text-ink">{title}</p>
      <p className="m-0 pt-1 text-xs text-muted">{description}</p>
      {children}
      {notice && (
        <div className="mt-4">
          <Notice>{notice}</Notice>
        </div>
      )}
      <div className="mt-4">{action}</div>
    </div>
  );
}

/* ------------------------------------------------------------- reserve tab */

function ReserveCard({
  invoice,
  active,
  requestsUnavailable,
  verificationUsable,
  disabledBase,
  busy,
  onReserve,
  onCreated,
}: {
  invoice: InvoiceDetailResponse;
  active: FinancingRequestResponse | null;
  requestsUnavailable: boolean;
  verificationUsable: boolean;
  disabledBase: boolean;
  busy: boolean;
  onReserve: () => void;
  onCreated: () => Promise<void>;
}) {
  if (!active) {
    return (
      <CreateRequestForm
        invoice={invoice}
        unavailable={requestsUnavailable}
        verificationUsable={verificationUsable}
        disabled={disabledBase}
        onCreated={onCreated}
      />
    );
  }

  const reservable = RESERVABLE.includes(active.status);
  return (
    <ActionCard
      title="Giữ chỗ claim"
      description="Giữ chỗ chính là thao tác neo trên chuỗi: nếu hoá đơn đã được neo thì không phát sinh giao dịch mới, yêu cầu tài trợ chỉ chuyển sang Đã giữ chỗ."
      notice={
        active.status === 'RESERVED'
          ? 'Claim đã được giữ chỗ cho yêu cầu tài trợ này.'
          : reservable
            ? null
            : `Yêu cầu đang ở trạng thái “${FINANCING_STATUS[active.status].label}” nên không thể giữ chỗ.`
      }
      action={
        <PrimaryButton
          className="!min-h-11 !px-5 !text-xs"
          disabled={disabledBase || !reservable}
          onClick={onReserve}
        >
          {busy && <Spinner />}
          Giữ chỗ claim
        </PrimaryButton>
      }
    >
      <p className="m-0 pt-3 text-[11px] text-lo">
        Yêu cầu: {active.requestedAmount} {active.currency} · {active.termDays} ngày ·{' '}
        {formatBps(active.interestRateBps)}/năm
      </p>
    </ActionCard>
  );
}

const inputClass =
  'mt-1 h-10 w-full rounded-xl border border-line bg-bg px-3 text-xs font-semibold text-ink outline-none focus:border-primary';

function CreateRequestForm({
  invoice,
  unavailable,
  verificationUsable,
  disabled,
  onCreated,
}: {
  invoice: InvoiceDetailResponse;
  unavailable: boolean;
  verificationUsable: boolean;
  disabled: boolean;
  onCreated: () => Promise<void>;
}) {
  const [amount, setAmount] = useState(invoice.amount);
  const [termDays, setTermDays] = useState('30');
  const [rate, setRate] = useState('');
  const [purpose, setPurpose] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const term = /^\d{1,3}$/.test(termDays) ? Number(termDays) : null;
  const bps = parsePercentToBps(rate);
  const valid =
    isPositiveAmount(amount.trim()) &&
    term !== null &&
    term >= 1 &&
    term <= 365 &&
    bps !== null &&
    purpose.trim().length >= 1 &&
    purpose.trim().length <= 280;

  async function submit() {
    if (!valid || term === null || bps === null) return;
    setSubmitting(true);
    setMessage(null);
    try {
      await api.createFinancingRequest({
        invoiceId: invoice.id,
        requestedAmount: amount.trim(),
        termDays: term,
        interestRateBps: bps,
        purpose: purpose.trim(),
      });
      await onCreated();
    } catch (e) {
      setMessage(describeError(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p className="m-0 text-sm font-bold text-ink">Tạo yêu cầu tài trợ</p>
      <p className="m-0 pt-1 text-xs text-muted">
        Chưa có yêu cầu tài trợ cho hoá đơn này. Tạo yêu cầu để có thể giữ chỗ và xác nhận tài trợ
        trên chuỗi.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
          Số tiền ({invoice.currency})
          <input
            className={inputClass}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
          Kỳ hạn (ngày)
          <input
            className={inputClass}
            inputMode="numeric"
            value={termDays}
            onChange={(e) => setTermDays(e.target.value)}
          />
        </label>
        <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
          Lãi suất (%/năm)
          <input
            className={inputClass}
            inputMode="decimal"
            placeholder="vd. 12,50"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </label>
        <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-muted sm:col-span-2">
          Mục đích
          <input
            className={inputClass}
            maxLength={280}
            placeholder="vd. Vốn lưu động cho đơn hàng quý 4"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </label>
      </div>
      {unavailable && (
        <div className="mt-4">
          <Notice tone="warning">
            Máy chủ chưa hỗ trợ yêu cầu tài trợ (endpoint chưa được triển khai).
          </Notice>
        </div>
      )}
      {!unavailable && !verificationUsable && (
        <div className="mt-4">
          <Notice>Cần kết quả xác minh Đạt hoặc Đã xác minh cục bộ.</Notice>
        </div>
      )}
      {message && (
        <div className="mt-4">
          <Notice tone="error">{message}</Notice>
        </div>
      )}
      <div className="mt-4">
        <PrimaryButton
          className="!min-h-11 !px-5 !text-xs"
          disabled={disabled || submitting || unavailable || !verificationUsable || !valid}
          onClick={() => void submit()}
        >
          {submitting && <Spinner />}
          Tạo yêu cầu tài trợ
        </PrimaryButton>
      </div>
    </div>
  );
}
