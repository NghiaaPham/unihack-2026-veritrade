'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClaimPanel } from '@/components/invoice-detail/claim-panel';
import { DetailTabs } from '@/components/invoice-detail/detail-tabs';
import { describeError, isChainNotConfigured } from '@/components/invoice-detail/errors';
import { OverviewPanel } from '@/components/invoice-detail/overview-panel';
import {
  BackLink,
  EmptyState,
  ErrorBanner,
  ExternalPill,
  GhostButton,
  Panel,
  SectionLabel,
  Skeleton,
  SmallButton,
  Spinner,
  StatusPill,
  Tag,
  TopStripPanel,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { chainName, explorerAddress, explorerTx, REGISTRY_ADDRESS } from '@/lib/chain';
import { shortHash } from '@/lib/format';
import { INVOICE_STATUS } from '@/lib/status';
import type {
  AnchorStatusResponse,
  BlockchainOperationResponse,
  FinancingRequestResponse,
  InvoiceDetailResponse,
  InvoiceHistoryResponse,
} from '@/lib/types';

interface DetailData {
  invoice: InvoiceDetailResponse;
  history: InvoiceHistoryResponse | null;
  anchor: AnchorStatusResponse | null;
  chainNotConfigured: boolean;
  requests: FinancingRequestResponse[];
  requestsUnavailable: boolean;
}

async function fetchDetail(id: string): Promise<DetailData> {
  const invoice = await api.getInvoice(id);
  const [history, anchor, requests] = await Promise.allSettled([
    api.getHistory(id),
    api.anchorStatus(id),
    api.listFinancingRequests({ invoiceId: id, limit: 50 }),
  ]);
  return {
    invoice,
    history: history.status === 'fulfilled' ? history.value : null,
    anchor: anchor.status === 'fulfilled' ? anchor.value : null,
    chainNotConfigured: anchor.status === 'rejected' && isChainNotConfigured(anchor.reason),
    requests: requests.status === 'fulfilled' ? requests.value.items : [],
    requestsUnavailable:
      requests.status === 'rejected' &&
      requests.reason instanceof ApiError &&
      requests.reason.status === 404,
  };
}

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { session } = useAuth();

  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [sessionOps, setSessionOps] = useState<Record<string, BlockchainOperationResponse>>({});
  const [verifying, setVerifying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await fetchDetail(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Không tải được hoá đơn.'));
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const trackOperation = useCallback((op: BlockchainOperationResponse) => {
    setSessionOps((prev) => ({ ...prev, [op.id]: op }));
  }, []);

  const operations = useMemo(() => {
    const merged = new Map<string, BlockchainOperationResponse>();
    if (data?.anchor?.operation) merged.set(data.anchor.operation.id, data.anchor.operation);
    for (const op of Object.values(sessionOps)) merged.set(op.id, op);
    return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [data, sessionOps]);

  async function reverify() {
    setVerifying(true);
    setActionError(null);
    try {
      await api.verify(id);
      await refresh();
    } catch (e) {
      setActionError(describeError(e));
    } finally {
      setVerifying(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setActionError('Không sao chép được liên kết — trình duyệt chặn quyền clipboard.');
    }
  }

  if (error && !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <section className="px-5 py-6 lg:px-8 lg:py-8">
        <BackLink href="/invoices">Quay lại sổ hoá đơn</BackLink>
        <div className="mt-5">
          {notFound ? (
            <EmptyState
              title="Không tìm thấy hoá đơn"
              description="Hoá đơn không tồn tại hoặc không thuộc tổ chức của bạn."
            />
          ) : (
            <ErrorBanner message={error.message} />
          )}
        </div>
      </section>
    );
  }

  if (!data) return <DetailSkeleton />;

  const { invoice, anchor } = data;
  const status = INVOICE_STATUS[invoice.status];
  const onChain = anchor !== null && anchor.claimStatus !== null && anchor.claimStatus !== 'UNREGISTERED';
  const anchorOp = anchor?.operation ?? null;
  const txLink = anchorOp?.txHash ? explorerTx(anchorOp.txHash, anchorOp.chainId) : null;
  const contractLink = explorerAddress(anchorOp?.contractAddress ?? REGISTRY_ADDRESS);
  const snowtrace = txLink ?? contractLink;

  return (
    <section className="px-5 py-6 lg:px-8 lg:py-8">
      <BackLink href="/invoices">Quay lại sổ hoá đơn</BackLink>

      <TopStripPanel className="mt-5" strip={5}>
        <div className="flex flex-col gap-5 p-6 lg:flex-row lg:items-start lg:justify-between lg:p-7">
          <div className="min-w-0">
            <SectionLabel>Hoá đơn của bạn</SectionLabel>
            <h1 className="m-0 pt-1.5 text-[22px] font-bold leading-tight tracking-[-0.4px] text-ink">
              Ký hiệu {invoice.invoiceSeries} · Số {invoice.invoiceNumber}
            </h1>
            <p className="m-0 pt-1 text-sm font-semibold text-muted">
              {invoice.sellerName} • {invoice.buyerName}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Tag>{invoice.invoiceTypeName ?? invoice.invoiceType}</Tag>
              <Tag muted>{chainName(anchorOp?.chainId)}</Tag>
              <Tag>{invoice.currency}</Tag>
              {invoice.document && <Tag>{invoice.document.format}</Tag>}
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
            </div>
            <div className="max-w-2xl pt-3">
              <p className="m-0 text-xs leading-relaxed text-muted">
                {onChain && anchor?.commitment
                  ? `Mã cam kết: ${shortHash(anchor.commitment)}`
                  : 'Chưa neo on-chain — chỉ mã cam kết (hash) sẽ được công bố, không có dữ liệu hoá đơn.'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">
            <GhostButton onClick={() => void copyLink()}>
              {copied ? 'Đã sao chép' : 'Sao chép liên kết'}
            </GhostButton>
            <SmallButton disabled={verifying} onClick={() => void reverify()}>
              {verifying && <Spinner />}
              Xác minh lại
            </SmallButton>
            {snowtrace && <ExternalPill href={snowtrace}>Xem trên Snowtrace</ExternalPill>}
          </div>
        </div>
      </TopStripPanel>

      {actionError && (
        <div className="mt-4">
          <ErrorBanner message={actionError} />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start">
        <ClaimPanel
          invoice={invoice}
          anchor={anchor}
          chainNotConfigured={data.chainNotConfigured}
          requests={data.requests}
          requestsUnavailable={data.requestsUnavailable}
          canWrite={session?.role !== 'VIEWER'}
          onOperation={trackOperation}
          onRefresh={refresh}
        />
        <OverviewPanel invoice={invoice} />
      </div>

      <DetailTabs
        verification={invoice.verification}
        history={data.history}
        operations={operations}
      />
    </section>
  );
}

function DetailSkeleton() {
  return (
    <section className="px-5 py-6 lg:px-8 lg:py-8" aria-busy="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-5 h-[200px] w-full !rounded-[20px]" />
      <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start">
        <Panel>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-4 h-10 w-full" />
          <Skeleton className="mt-5 h-16 w-full" />
          <Skeleton className="mt-5 h-9 w-72" />
          <Skeleton className="mt-4 h-40 w-full" />
        </Panel>
        <Panel>
          <Skeleton className="h-3 w-32" />
          <div className="mt-5 flex flex-col gap-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        </Panel>
      </div>
      <Skeleton className="mt-8 h-9 w-96" />
      <Skeleton className="mt-5 h-64 w-full !rounded-[14px]" />
    </section>
  );
}
