'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionPanel } from '@/components/fund/action-panel';
import { StatusTimeline } from '@/components/fund/status-timeline';
import { stripGradient, type ClaimAction } from '@/components/fund/format';
import {
  BackLink,
  EmptyState,
  ErrorBanner,
  ExternalPill,
  KeyValueList,
  Panel,
  SectionLabel,
  Skeleton,
  StatusPill,
  Tag,
  cardShadow,
} from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { chainName, explorerTx } from '@/lib/chain';
import { formatDate, formatDateTime, relativeDays } from '@/lib/format';
import { CLAIM_STATUS, FINANCING_STATUS, INVOICE_STATUS } from '@/lib/status';
import type {
  AnchorStatusResponse,
  BlockchainOperationResponse,
  FinancingRequestResponse,
  OperationStatus,
} from '@/lib/types';

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; data: FinancingRequestResponse }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

const IN_FLIGHT: OperationStatus[] = ['PENDING', 'SUBMITTING', 'SUBMITTED', 'UNKNOWN'];
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TRIES = 40;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function describeActionError(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Có lỗi không xác định khi gửi thao tác.';
  if (e.status === 0) return 'Không kết nối được tới máy chủ API. Kiểm tra mạng rồi thử lại.';
  if (e.status === 409 && e.code === 'INVALID_FINANCING_STATE')
    return 'Trạng thái hiện tại của yêu cầu không cho phép thao tác này. Hãy tải lại trang.';
  if (e.status === 409 && e.code === 'INVOICE_NOT_VERIFIED')
    return 'Hoá đơn chưa được xác minh nên chưa thể giữ chỗ claim.';
  if (e.status === 429)
    return `Đã chạm giới hạn gửi giao dịch on-chain. ${e.message} Hãy thử lại sau ít phút.`;
  if (e.status === 503 && e.code === 'BLOCKCHAIN_NOT_CONFIGURED')
    return 'Máy chủ chưa cấu hình kết nối blockchain nên chưa thể gửi giao dịch.';
  return e.message;
}

export default function FundDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [anchor, setAnchor] = useState<AnchorStatusResponse | null>(null);
  const [sessionOp, setSessionOp] = useState<BlockchainOperationResponse | null>(null);
  const [busy, setBusy] = useState<ClaimAction | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    api
      .getFinancingRequest(id)
      .then((data) => {
        if (live) setLoad({ kind: 'ready', data });
      })
      .catch((e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) setLoad({ kind: 'missing' });
        else
          setLoad({
            kind: 'error',
            message: e instanceof ApiError ? e.message : 'Không tải được yêu cầu tài trợ.',
          });
      });
    return () => {
      live = false;
    };
  }, [id]);

  const invoiceId = load.kind === 'ready' ? load.data.invoice.id : null;
  useEffect(() => {
    if (!invoiceId) return;
    let live = true;
    api
      .anchorStatus(invoiceId)
      .then((res) => {
        if (live) setAnchor(res);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [invoiceId]);

  const run = useCallback(
    async (action: ClaimAction) => {
      setBusy(action);
      setActionError(null);
      setProgress('Đang gửi yêu cầu tới máy chủ…');
      try {
        const res = await api.financing(id, action);
        if (!alive.current) return;
        let op = res.operation;
        setSessionOp(op);

        for (let i = 0; op && IN_FLIGHT.includes(op.status) && i < POLL_MAX_TRIES; i++) {
          setProgress('Giao dịch đã gửi, đang chờ xác nhận trên chain…');
          await sleep(POLL_INTERVAL_MS);
          if (!alive.current) return;
          try {
            op = await api.transaction(op.id);
          } catch (e) {
            if (e instanceof ApiError && e.status !== 0 && e.status < 500) throw e;
            continue;
          }
          if (!alive.current) return;
          setSessionOp(op);
        }

        if (op && IN_FLIGHT.includes(op.status)) {
          setActionError(
            'Giao dịch vẫn đang được xử lý sau 2 phút. Hãy tải lại trang sau ít phút để xem kết quả.',
          );
        } else if (op && (op.status === 'FAILED' || op.status === 'CANCELLED')) {
          setActionError(op.error?.message ?? 'Giao dịch on-chain không thành công.');
        }

        const [fresh, claim] = await Promise.all([
          api.getFinancingRequest(id),
          invoiceId ? api.anchorStatus(invoiceId).catch(() => null) : Promise.resolve(null),
        ]);
        if (!alive.current) return;
        setLoad({ kind: 'ready', data: fresh });
        if (claim) setAnchor(claim);
      } catch (e) {
        if (alive.current) setActionError(describeActionError(e));
      } finally {
        if (alive.current) {
          setBusy(null);
          setProgress(null);
        }
      }
    },
    [id, invoiceId],
  );

  if (load.kind === 'loading') {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-[170px] rounded-[20px]" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-[380px] rounded-[20px]" />
          <Skeleton className="h-[380px] rounded-[20px]" />
        </div>
      </div>
    );
  }

  if (load.kind === 'missing' || load.kind === 'error') {
    return (
      <div className="flex flex-col gap-5">
        <BackLink href="/fund">Quay lại danh sách</BackLink>
        {load.kind === 'error' ? (
          <ErrorBanner message={load.message} />
        ) : (
          <EmptyState
            title="Không tìm thấy yêu cầu tài trợ"
            description="Yêu cầu không tồn tại, hoặc thuộc về một tổ chức khác với tổ chức đang đăng nhập."
          />
        )}
      </div>
    );
  }

  const request = load.data;
  const { invoice } = request;
  const status = FINANCING_STATUS[request.status];
  const invoiceStatus = INVOICE_STATUS[invoice.status];
  const operation = sessionOp ?? anchor?.operation ?? null;
  const txUrl = operation?.txHash ? explorerTx(operation.txHash) : null;
  const claim = anchor?.claimStatus ? CLAIM_STATUS[anchor.claimStatus] : null;
  const due = relativeDays(invoice.dueDate);

  return (
    <div>
      <BackLink href="/fund">Quay lại danh sách</BackLink>

      <div
        className="relative mt-5 overflow-hidden rounded-[20px] bg-surface"
        style={{ border: '1px solid var(--color-border)', boxShadow: cardShadow }}
      >
        <div className="w-full" style={{ height: 5, background: stripGradient('primary') }} />
        <div className="flex flex-col gap-5 p-6 lg:flex-row lg:items-start lg:justify-between lg:p-7">
          <div className="min-w-0">
            <SectionLabel>Yêu cầu tài trợ</SectionLabel>
            <h1 className="m-0 pt-1.5 text-[22px] font-bold leading-tight tracking-[-0.4px] text-ink">
              {invoice.sellerName}
            </h1>
            <p className="m-0 pt-1 text-sm font-semibold text-muted">
              Hoá đơn {invoice.invoiceSeries}-{invoice.invoiceNumber} • {invoice.buyerName}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Tag muted>{chainName()}</Tag>
              <Tag>{request.currency}</Tag>
              <Tag>{request.termDays} ngày</Tag>
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
            </div>
            <div className="max-w-2xl pt-3">
              <p className="m-0 text-xs leading-relaxed text-muted">
                Giữ chỗ claim để contract từ chối mọi bên khác tài trợ cùng hoá đơn này. Chuỗi khối
                chỉ lưu mã cam kết (hash), không lưu dữ liệu hoá đơn.
              </p>
            </div>
          </div>
          {txUrl && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">
              <ExternalPill href={txUrl}>Xem giao dịch trên Snowtrace</ExternalPill>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start">
        <ActionPanel
          key={request.status}
          request={request}
          busy={busy}
          progress={progress}
          error={actionError}
          onRun={run}
        />

        <Panel>
          <SectionLabel>Tổng quan</SectionLabel>
          <div className="mt-3">
            <KeyValueList
              rows={[
                {
                  label: 'Mục đích',
                  value: <span title={request.purpose}>{request.purpose}</span>,
                },
                { label: 'Ngày tạo', value: formatDateTime(request.createdAt) },
                {
                  label: 'Bên bán',
                  value: invoice.sellerName,
                  aside: `MST ${invoice.sellerTaxId}`,
                },
                { label: 'Bên mua', value: invoice.buyerName },
                { label: 'Ngày phát hành', value: formatDate(invoice.issueDate) },
                {
                  label: 'Hạn hoá đơn',
                  value: formatDate(invoice.dueDate),
                  aside: due ?? undefined,
                },
                {
                  label: 'Trạng thái hoá đơn',
                  value: invoiceStatus.label,
                  tone: invoiceStatus.tone,
                },
                ...(claim
                  ? [{ label: 'Claim on-chain', value: claim.label, tone: claim.tone }]
                  : []),
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="mt-6">
        <StatusTimeline
          status={request.status}
          createdAt={request.createdAt}
          operation={operation}
        />
      </div>
    </div>
  );
}
