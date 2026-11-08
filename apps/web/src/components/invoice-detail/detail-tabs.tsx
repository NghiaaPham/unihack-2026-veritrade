'use client';

import { useState } from 'react';
import { EmptyState, GridTable, Segmented, TablePill } from '@/components/ui';
import { explorerTx } from '@/lib/chain';
import { formatDateTime, shortHash } from '@/lib/format';
import {
  CHECK_LABEL,
  CHECK_STATUS,
  OPERATION_KIND,
  OPERATION_STATUS,
  VERIFICATION_STATUS,
  checkMessage,
  limitationText,
} from '@/lib/status';
import type {
  BlockchainOperationResponse,
  InvoiceHistoryResponse,
  VerificationResponse,
} from '@/lib/types';

type DetailTab = 'checks' | 'verifications' | 'events' | 'operations';

const EVENT_LABEL: Record<string, string> = {
  'invoice.created': 'Tải lên hoá đơn',
  'invoice.verified': 'Chạy xác minh hoá đơn',
  'financing_request.created': 'Tạo yêu cầu tài trợ',
  'blockchain.operation.confirmed': 'Giao dịch on-chain được xác nhận',
};

const cellText = 'text-[11px] text-muted';

export function DetailTabs({
  verification,
  history,
  operations,
}: {
  verification: VerificationResponse | null;
  history: InvoiceHistoryResponse | null;
  operations: BlockchainOperationResponse[];
}) {
  const [tab, setTab] = useState<DetailTab>('checks');

  return (
    <div className="mt-8">
      <Segmented<DetailTab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'checks', label: 'Kết quả kiểm tra' },
          { value: 'verifications', label: 'Lịch sử xác minh' },
          { value: 'events', label: 'Nhật ký sự kiện' },
          { value: 'operations', label: 'Giao dịch on-chain' },
        ]}
      />
      <div className="mt-5">
        {tab === 'checks' && <ChecksTable verification={verification} />}
        {tab === 'verifications' && <VerificationsTable history={history} />}
        {tab === 'events' && <EventsTable history={history} />}
        {tab === 'operations' && <OperationsTable operations={operations} />}
      </div>
    </div>
  );
}

function ChecksTable({ verification }: { verification: VerificationResponse | null }) {
  if (!verification) {
    return (
      <EmptyState
        title="Chưa có kết quả kiểm tra"
        description="Bấm “Xác minh lại” ở đầu trang để chạy 7 bước kiểm tra cho hoá đơn này."
      />
    );
  }
  return (
    <>
      <GridTable
        columns={['#', 'Bước kiểm tra', 'Kết quả', 'Ghi chú']}
        template="0.4fr 1.6fr 1fr 2.6fr"
        rows={verification.checks.map((check, i) => [
          <span key="n" className="text-[13px] font-semibold text-ink">
            {i + 1}
          </span>,
          <span key="l" className="text-[13px] font-semibold text-ink">
            {CHECK_LABEL[check.key] ?? check.label}
          </span>,
          <TablePill key="s" tone={CHECK_STATUS[check.status].tone}>
            {CHECK_STATUS[check.status].label}
          </TablePill>,
          <span key="m" className={cellText}>
            {checkMessage(check.message)}
          </span>,
        ])}
      />
      <div className="mt-3 flex flex-col gap-1 px-1 text-[11px] text-muted">
        <span className="font-semibold text-ink">
          Phạm vi: Chỉ kiểm tra cục bộ (LOCAL_CHECKS_ONLY)
        </span>
        {verification.limitations.map((limitation) => (
          <span key={limitation}>• {limitationText(limitation)}</span>
        ))}
      </div>
    </>
  );
}

function VerificationsTable({ history }: { history: InvoiceHistoryResponse | null }) {
  const items = history?.verifications ?? [];
  return (
    <GridTable
      columns={['Thời điểm', 'Trạng thái', 'Số bước đạt']}
      template="1.4fr 1.2fr 1fr"
      empty="Chưa có lần xác minh nào."
      rows={items.map((v) => [
        <span key="t" className={cellText}>
          {formatDateTime(v.checkedAt ?? v.createdAt)}
        </span>,
        <TablePill key="s" tone={VERIFICATION_STATUS[v.status].tone}>
          {VERIFICATION_STATUS[v.status].label}
        </TablePill>,
        <span key="p" className="text-[13px] font-bold text-ink">
          {v.checks.filter((c) => c.status === 'PASSED').length}/{v.checks.length}
        </span>,
      ])}
    />
  );
}

function EventsTable({ history }: { history: InvoiceHistoryResponse | null }) {
  const items = history?.events ?? [];
  return (
    <GridTable
      columns={['Sự kiện', 'Thời điểm']}
      template="2fr 1.2fr"
      empty="Chưa có sự kiện nào."
      rows={items.map((e) => [
        <span key="a" className="text-[13px] font-semibold text-ink">
          {EVENT_LABEL[e.action] ?? e.action}
        </span>,
        <span key="t" className={cellText}>
          {formatDateTime(e.createdAt)}
        </span>,
      ])}
    />
  );
}

function OperationsTable({ operations }: { operations: BlockchainOperationResponse[] }) {
  return (
    <GridTable
      columns={['Loại', 'Trạng thái', 'Tx hash', 'Block', 'Thời điểm']}
      template="1.4fr 1fr 1.2fr 0.7fr 1.2fr"
      empty="Chưa có giao dịch on-chain nào cho hoá đơn này."
      rows={operations.map((op) => {
        const href = op.txHash ? explorerTx(op.txHash, op.chainId) : null;
        return [
          <span key="k" className="text-[13px] font-semibold text-ink">
            {OPERATION_KIND[op.kind]}
          </span>,
          <div key="s" className="flex flex-col items-start gap-1">
            <TablePill tone={OPERATION_STATUS[op.status].tone}>
              {OPERATION_STATUS[op.status].label}
            </TablePill>
            {op.error && <span className="text-[10px] text-error">{op.error.message}</span>}
          </div>,
          op.txHash ? (
            href ? (
              <a
                key="h"
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-semibold text-primary no-underline hover:underline"
              >
                {shortHash(op.txHash)}
              </a>
            ) : (
              <span key="h" className="font-mono text-[11px] text-muted">
                {shortHash(op.txHash)}
              </span>
            )
          ) : (
            <span key="h" className={cellText}>
              —
            </span>
          ),
          <span key="b" className={cellText}>
            {op.receipt?.blockNumber ?? '—'}
          </span>,
          <span key="t" className={cellText}>
            {formatDateTime(op.confirmedAt ?? op.submittedAt ?? op.createdAt)}
          </span>,
        ];
      })}
    />
  );
}
