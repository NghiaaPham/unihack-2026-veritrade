'use client';

import Link from 'next/link';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { LogoMark } from '@/components/shell';

export type PortalRole = 'supplier' | 'financier';

export const ROLE_META: Record<PortalRole, { label: string; color: string; home: string }> = {
  supplier: { label: 'Bên bán', color: '129, 130, 239', home: '/dashboard' },
  financier: { label: 'Bên tài trợ', color: '225, 163, 37', home: '/fund' },
};

export function parseRole(value: string | null): PortalRole {
  return value === 'financier' ? 'financier' : 'supplier';
}

export function AuthCard({
  role,
  title,
  subtitle,
  children,
  footer,
}: {
  role: PortalRole;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const meta = ROLE_META[role];
  return (
    <div className="login-mesh flex min-h-screen items-center justify-center px-5 py-12 sm:px-8">
      <div className="flex w-full max-w-[440px] flex-col items-center">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <LogoMark size={30} color={`rgb(${meta.color})`} />
          <span className="text-[28px] font-bold leading-none tracking-[-0.8px] text-[#F0EEF8]">
            VeriTrade
          </span>
        </Link>
        <div className="login-glass relative mt-8 w-full overflow-hidden p-7 sm:p-8">
          <div
            className="absolute left-0 right-0 top-0 h-[3px]"
            style={{
              background: `linear-gradient(90deg, rgb(${meta.color}), rgba(${meta.color}, 0.4), transparent)`,
            }}
          />
          <span
            className="text-[10px] font-bold uppercase tracking-[0.16em]"
            style={{ color: `rgb(${meta.color})` }}
          >
            {meta.label}
          </span>
          <h1 className="m-0 mt-1.5 text-[24px] font-bold tracking-[-0.5px] text-[#F0EEF8]">
            {title}
          </h1>
          <p className="m-0 mt-1.5 text-[12.5px] leading-relaxed text-white/55">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
        <div className="mt-6 text-center text-[12px] text-white/50">{footer}</div>
      </div>
    </div>
  );
}

export function AuthField({
  label,
  hint,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-white/55">
        {label}
      </span>
      <input
        {...input}
        className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 text-[13.5px] text-[#F0EEF8] outline-none transition-colors placeholder:text-white/30 focus:border-[#8182EF] focus:bg-white/[0.07]"
      />
      {hint && <span className="mt-1 block text-[11px] text-white/40">{hint}</span>}
    </label>
  );
}

export function AuthSelect({
  label,
  children,
  ...select
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-white/55">
        {label}
      </span>
      <select
        {...select}
        className="h-12 w-full rounded-xl border border-white/10 bg-[#120a2c] px-4 text-[13.5px] text-[#F0EEF8] outline-none focus:border-[#8182EF]"
      >
        {children}
      </select>
    </label>
  );
}

export function AuthError({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl px-4 py-3 text-[12px] font-medium"
      style={{
        background: 'rgba(196, 24, 72, 0.14)',
        color: '#ff8fae',
        border: '1px solid rgba(196, 24, 72, 0.35)',
      }}
    >
      {message}
    </div>
  );
}

export function AuthSubmit({
  children,
  busy,
  color,
}: {
  children: ReactNode;
  busy: boolean;
  color: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full px-6 text-sm font-bold text-white transition-all hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
      style={{ background: `rgb(${color})`, boxShadow: `rgba(${color}, 0.4) 0px 4px 18px` }}
    >
      {busy ? 'Đang xử lý…' : children}
    </button>
  );
}
