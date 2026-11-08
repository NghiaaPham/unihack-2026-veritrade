'use client';

import type { ReactNode } from 'react';
import { Avatar } from '@/components/shell';
import { DetailGrid, StatusIcon } from '@/components/verification/parts';
import { SectionLabel, TONE_RGB, cardShadow } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { CHAIN_ID, REGISTRY_ADDRESS, chainName, explorerAddress } from '@/lib/chain';
import { formatDateTime } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/status';

const PRIVACY_POINTS = [
  'Chỉ mã cam kết (commitment hash) và mã thực thể đã băm (entity id hash) được ghi lên chuỗi.',
  'Tên, mã số thuế, số tiền và nội dung hoá đơn không bao giờ được đưa lên blockchain.',
  'Máy chủ quyết định lệnh gọi hợp đồng; trình duyệt không bao giờ gửi khoá riêng hay giao dịch thô.',
  'Blockchain chỉ là lớp cam kết chống tài trợ trùng — không lưu trữ dữ liệu hoá đơn.',
];

function StripCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-[20px] bg-surface transition-all duration-150"
      style={{ border: '1px solid var(--color-border)', boxShadow: cardShadow }}
    >
      <div
        className="w-full"
        style={{
          height: 4,
          background: `linear-gradient(90deg, rgb(${TONE_RGB.primary}) 0%, rgba(${TONE_RGB.primary}, 0.8) 50%, transparent 100%)`,
        }}
      />
      <div className="space-y-5 p-5 sm:p-6">
        <SectionLabel>{title}</SectionLabel>
        {children}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { session } = useAuth();
  if (!session) return null;

  const { organization, user, role } = session;
  const address = REGISTRY_ADDRESS || null;
  const addressUrl = address ? explorerAddress(address) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <SectionLabel>Hồ sơ</SectionLabel>
          <h1 className="m-0 mt-1 truncate text-[22px] font-bold leading-tight tracking-[-0.4px] text-ink">
            {organization.name}
          </h1>
          <p className="m-0 pt-1 text-xs text-muted">
            {ROLE_LABEL[role] ?? role} · <span className="font-mono">{organization.slug}</span>
          </p>
        </div>
      </header>

      <StripCard title="Thông tin tổ chức">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface2 text-3xl font-bold text-primary sm:h-24 sm:w-24">
            {organization.name.trim().charAt(0).toUpperCase() || '?'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[18px] font-bold text-ink">{organization.name}</div>
            <div className="mt-0.5 text-xs text-muted">{ROLE_LABEL[role] ?? role}</div>
          </div>
        </div>
        <div className="border-t border-line pt-5">
          <DetailGrid
            fields={[
              { label: 'Tên tổ chức', value: organization.name },
              {
                label: 'Mã tổ chức (slug)',
                value: <span className="font-mono">{organization.slug}</span>,
              },
              { label: 'Vai trò của bạn', value: ROLE_LABEL[role] ?? role },
              {
                label: 'ID tổ chức',
                value: <span className="font-mono text-xs">{organization.id}</span>,
              },
            ]}
          />
        </div>
      </StripCard>

      <StripCard title="Tài khoản đăng nhập">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-bg px-3 py-2.5 sm:px-4 sm:py-3">
          <Avatar name={user.displayName} size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">
              {user.displayName}
              <span className="ml-2 rounded-full bg-surface2 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wide text-muted">
                Bạn
              </span>
            </div>
            <div className="truncate text-xs text-muted">{user.email}</div>
          </div>
        </div>
        <DetailGrid
          fields={[
            {
              label: 'Phiên đăng nhập hết hạn',
              value: formatDateTime(new Date(session.expiresAt).toISOString()),
            },
          ]}
        />
      </StripCard>

      <StripCard title="Mạng blockchain">
        <DetailGrid
          fields={[
            { label: 'Mạng', value: chainName() },
            { label: 'Chain ID', value: CHAIN_ID },
            {
              label: 'Hợp đồng đăng ký hoá đơn',
              wide: true,
              value: address ? (
                addressUrl ? (
                  <a
                    href={addressUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs font-semibold text-primary no-underline hover:underline"
                  >
                    {address} ↗
                  </a>
                ) : (
                  <span className="font-mono text-xs">{address}</span>
                )
              ) : (
                'Chưa cấu hình'
              ),
            },
          ]}
        />
      </StripCard>

      <StripCard title="Bảo mật & quyền riêng tư">
        <p className="m-0 -mt-2 text-xs text-muted">
          Những gì được ghi lên blockchain khi bạn neo một hoá đơn.
        </p>
        <div className="space-y-3">
          {PRIVACY_POINTS.map((point) => (
            <div
              key={point}
              className="flex items-start gap-2 rounded-xl border border-line p-3 text-sm font-semibold text-ink"
            >
              <span className="mt-0.5">
                <StatusIcon tone="success" kind="ok" />
              </span>
              {point}
            </div>
          ))}
        </div>
      </StripCard>
    </div>
  );
}
