import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoMark } from '@/components/shell';

interface Persona {
  key: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  body: string;
  cta: string;
  href: string;
  color: string;
  icon: ReactNode;
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const PERSONAS: Persona[] = [
  {
    key: 'supplier',
    eyebrow: 'Bên bán',
    title: 'Doanh nghiệp',
    subtitle: 'Nhà cung ứng · Người bán hàng',
    body: 'Tải hoá đơn điện tử, xác minh và neo cam kết lên Avalanche để huy động vốn.',
    cta: 'Vào với vai bên bán',
    href: '/login?role=supplier',
    color: '129, 130, 239',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" {...stroke}>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
        <path d="M14 3v5h5M9 13h6M9 17h4" />
      </svg>
    ),
  },
  {
    key: 'verify',
    eyebrow: 'Kiểm chứng',
    title: 'Kiểm toán viên',
    subtitle: 'Công chúng · Không cần đăng nhập',
    body: 'Tra cứu trạng thái claim của một hoá đơn trực tiếp từ smart contract.',
    cta: 'Mở trang kiểm chứng',
    href: '/verify',
    color: '59, 201, 138',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" {...stroke}>
        <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    key: 'financier',
    eyebrow: 'Bên tài trợ',
    title: 'Tổ chức tài chính',
    subtitle: 'Ngân hàng · Công ty factoring',
    body: 'Giữ chỗ, xác nhận tài trợ và đóng claim — một hoá đơn chỉ được tài trợ một lần.',
    cta: 'Vào với vai bên tài trợ',
    href: '/login?role=financier',
    color: '225, 163, 37',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" {...stroke}>
        <path d="M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M12 3l9 5H3l9-5Z" />
      </svg>
    ),
  },
];

export default function RolePickerPage() {
  return (
    <div className="login-mesh flex min-h-screen items-center justify-center px-5 py-12 sm:px-8">
      <div className="flex w-full max-w-[900px] flex-col items-center">
        <div className="flex items-center gap-3">
          <LogoMark size={40} color="rgb(129, 130, 239)" />
          <span className="text-[40px] font-bold leading-none tracking-[-1.2px] text-[#F0EEF8]">
            VeriTrade
          </span>
        </div>
        <h1 className="m-0 mt-8 text-center text-[clamp(28px,4.5vw,44px)] font-semibold leading-[1.08] tracking-[-1px] text-[#F0EEF8]">
          Hôm nay bạn là <span className="irid">ai?</span>
        </h1>
        <p className="mt-3 max-w-md text-center text-[14px] leading-relaxed text-white/60">
          Chọn một vai trò để khám phá — mỗi vai trò có không gian làm việc riêng.
        </p>

        <div className="mt-9 grid w-full gap-4 sm:grid-cols-3 sm:gap-5">
          {PERSONAS.map((p) => (
            <Link
              key={p.key}
              href={p.href}
              className="login-glass group relative flex flex-col items-center overflow-hidden p-6 text-center no-underline transition-all duration-300 hover:-translate-y-1 sm:p-7"
            >
              <div
                className="absolute left-0 right-0 top-0 h-[3px]"
                style={{
                  background: `linear-gradient(90deg, rgb(${p.color}), rgba(${p.color}, 0.4), transparent)`,
                }}
              />
              <span
                className="flex h-24 w-24 items-center justify-center rounded-full transition-transform duration-300 group-hover:scale-105"
                style={{
                  border: `2px solid rgb(${p.color})`,
                  boxShadow: `rgba(${p.color}, 0.267) 0px 0px 24px`,
                  color: `rgb(${p.color})`,
                  background: `radial-gradient(circle at 30% 25%, rgba(${p.color}, 0.22), rgba(13, 5, 35, 0.9) 70%)`,
                }}
              >
                {p.icon}
              </span>
              <span
                className="mt-5 text-[10px] font-bold uppercase tracking-[0.16em]"
                style={{ color: `rgb(${p.color})` }}
              >
                {p.eyebrow}
              </span>
              <span className="mt-1 text-lg font-bold tracking-[-0.3px] text-[#F0EEF8]">{p.title}</span>
              <span className="mt-0.5 text-[11px] text-white/45">{p.subtitle}</span>
              <span className="mt-3 text-[12.5px] leading-relaxed text-white/65">{p.body}</span>
              <span
                className="mt-5 flex items-center gap-1.5 text-[12.5px] font-semibold"
                style={{ color: `rgb(${p.color})` }}
              >
                {p.cta}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            </Link>
          ))}
        </div>

        <p className="mt-8 text-center text-[11.5px] text-white/40">
          Nội dung hoá đơn không bao giờ lên chain — chỉ có{' '}
          <span className="font-semibold text-[#8182EF]">mã cam kết</span> được neo trên Avalanche.
        </p>
      </div>
    </div>
  );
}
