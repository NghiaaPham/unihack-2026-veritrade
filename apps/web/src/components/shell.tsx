'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { chainName } from '@/lib/chain';
import { ROLE_LABEL } from '@/lib/status';

/* ------------------------------------------------------------------ logo */

export function LogoMark({
  size = 24,
  color = 'rgb(90, 91, 235)',
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M2.5 3.5h19L12 21.5 2.5 3.5Z" fill={color} />
      <path
        d="m7.6 8.6 3.1 3.1 5.7-5.4"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ product, href, color }: { product: string; href: string; color?: string }) {
  return (
    <Link href={href} className="flex h-full shrink-0 items-center gap-[9px] px-6 no-underline">
      <LogoMark color={color} />
      <span className="text-[22px] font-bold leading-none tracking-[-0.6px] text-[#111827]">
        {product}
      </span>
    </Link>
  );
}

/* -------------------------------------------------------------- demo bar */

export function DemoBar() {
  return (
    <div className="sticky top-0 z-30 flex h-[var(--demo-bar-h)] items-center gap-2 border-b border-amber-500/20 bg-[color-mix(in_srgb,rgb(245_158_11)_15%,var(--color-surface))] px-3 text-xs font-medium text-amber-700 sm:px-4">
      <Link
        href="/"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 font-semibold text-ink no-underline transition-colors hover:bg-bg"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M19 12H5M11 18l-6-6 6-6" />
        </svg>
        Chọn vai trò
      </Link>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-center">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="shrink-0"
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span className="truncate sm:hidden">Bản thử nghiệm</span>
        <span className="hidden truncate sm:inline">
          Môi trường thử nghiệm — giao dịch chạy trên {chainName()} Testnet, không có giá trị thật.
        </span>
      </div>
      <Link
        href="/verify"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 font-semibold text-white no-underline transition-opacity hover:opacity-90"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
        <span className="sm:hidden">Kiểm chứng</span>
        <span className="hidden sm:inline">Kiểm chứng on-chain</span>
      </Link>
    </div>
  );
}

/* -------------------------------------------------------------- user menu */

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(135deg, rgb(90, 91, 235), rgb(129, 130, 239))',
      }}
    >
      {initials || '?'}
    </span>
  );
}

export function UserMenu() {
  const { session, signOut } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!session) return null;
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer select-none items-center gap-2"
      >
        <span className="hidden text-xs font-medium text-muted sm:inline">
          {session.user.displayName}
        </span>
        <Avatar name={session.user.displayName} />
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-muted"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute right-0 top-11 z-40 w-64 rounded-2xl bg-surface p-2"
          style={{
            border: '1px solid var(--color-border)',
            boxShadow: 'rgba(15, 23, 42, 0.12) 0px 10px 30px',
          }}
        >
          <div className="px-3 py-2.5">
            <div className="truncate text-[13px] font-bold text-ink">
              {session.user.displayName}
            </div>
            <div className="truncate text-[11px] text-muted">{session.user.email}</div>
            <div className="mt-1.5 truncate text-[11px] text-lo">
              {session.organization.name} · {ROLE_LABEL[session.role] ?? session.role}
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-3 py-2 text-xs font-semibold text-ink no-underline hover:bg-surface2"
          >
            Hồ sơ doanh nghiệp
          </Link>
          <button
            type="button"
            onClick={() => {
              signOut();
              router.replace('/');
            }}
            className="block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-xs font-semibold text-error hover:bg-surface2"
          >
            Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}

function NetworkPill() {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface2 px-3 py-[5px]">
      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
        {chainName()}
      </span>
    </span>
  );
}

/* --------------------------------------------------------- supplier shell */

const SUPPLIER_NAV = [
  { href: '/dashboard', label: 'Tổng quan', match: ['/dashboard'] },
  { href: '/invoices', label: 'Hoá đơn', match: ['/invoices', '/transactions', '/profile'] },
  { href: '/verification', label: 'Xác minh', match: ['/verification'] },
];

const INVOICE_SUBNAV = [
  { href: '/invoices', label: 'Sổ hoá đơn', exact: true },
  { href: '/invoices/upload', label: 'Tải lên', exact: true },
  { href: '/transactions', label: 'Giao dịch on-chain', exact: false },
  { href: '/profile', label: 'Hồ sơ', exact: false },
];

function isActive(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function SupplierShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const inInvoices = isActive(pathname, ['/invoices', '/transactions', '/profile']);
  const invoiceDetail = /^\/invoices\/(?!upload$)[^/]+$/.test(pathname);

  return (
    <>
      <DemoBar />
      <div className="flex min-h-screen flex-col bg-bg">
        <header className="sticky top-[var(--demo-bar-h,0px)] z-20 flex h-16 items-center border-b border-line bg-surface">
          <Logo product="VeriTrade" href="/dashboard" />
          <nav className="hidden h-full items-center gap-1.5 pr-6 md:flex">
            {SUPPLIER_NAV.map((item) => {
              const active = isActive(pathname, item.match);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="select-none whitespace-nowrap rounded-full px-4 py-[5px] text-[13px] no-underline transition-all duration-150"
                  style={
                    active
                      ? {
                          fontWeight: 700,
                          color: 'rgb(90, 91, 235)',
                          background: 'rgba(90, 91, 235, 0.1)',
                          boxShadow: 'rgb(90, 91, 235) 0px 0px 0px 1.5px inset',
                        }
                      : { fontWeight: 500, color: 'var(--color-muted)' }
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex h-full shrink-0 items-center gap-3 px-6">
            <div className="hidden items-center gap-2 sm:flex">
              <NetworkPill />
            </div>
            <div className="hidden h-6 w-px bg-line sm:block" />
            <UserMenu />
          </div>
        </header>

        {inInvoices && (
          <div className="flex items-center border-b border-line bg-surface">
            <div className="flex-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              <div className="flex h-[52px] min-w-max items-center gap-1.5 px-5 md:px-7">
                {INVOICE_SUBNAV.map((item) => {
                  const active = item.exact
                    ? pathname === item.href || (item.href === '/invoices' && invoiceDetail)
                    : isActive(pathname, [item.href]);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="shrink-0 whitespace-nowrap rounded-full px-[18px] py-2 text-[13px] no-underline transition-all duration-150"
                      style={
                        active
                          ? {
                              fontWeight: 600,
                              color: 'rgb(90, 91, 235)',
                              background: 'var(--color-surface)',
                              border: '1.5px solid rgb(90, 91, 235)',
                            }
                          : {
                              fontWeight: 500,
                              color: 'var(--color-muted)',
                              border: '1.5px solid transparent',
                            }
                      }
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1">
          <section className="px-5 py-6 lg:px-8 lg:py-8">{children}</section>
        </main>
        <Footer />
      </div>
    </>
  );
}

/* -------------------------------------------------------- financier shell */

export function FinancierShell({ children }: { children: ReactNode }) {
  return (
    <>
      <DemoBar />
      <div className="flex min-h-screen flex-col bg-bg">
        <header className="sticky top-[var(--demo-bar-h,0px)] z-20 flex h-16 items-center justify-between border-b border-line bg-surface pr-5 lg:pr-8">
          <Logo product="VeriTrade Fund" href="/fund" color="rgb(225, 163, 37)" />
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex">
              <NetworkPill />
            </div>
            <div className="hidden h-6 w-px bg-line sm:block" />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1">
          <section className="px-5 py-6 lg:px-8 lg:py-8">{children}</section>
        </main>
        <Footer />
      </div>
    </>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface px-5 py-5 text-center lg:px-8">
      <p className="m-0 text-xs text-muted">VeriTrade · Neo cam kết hoá đơn trên Avalanche</p>
    </footer>
  );
}
