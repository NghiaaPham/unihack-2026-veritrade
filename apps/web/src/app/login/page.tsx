'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import {
  AuthCard,
  AuthError,
  AuthField,
  AuthSubmit,
  parseRole,
  ROLE_META,
} from '@/components/auth-card';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function LoginForm() {
  const params = useSearchParams();
  const role = parseRole(params.get('role'));
  const meta = ROLE_META[role];
  const router = useRouter();
  const { session, ready, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && session) router.replace(meta.home);
  }, [ready, session, router, meta.home]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.login({
        email: email.trim(),
        password,
        ...(slug.trim() ? { organizationSlug: slug.trim() } : {}),
      });
      signIn(result);
      router.replace(meta.home);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Email hoặc mật khẩu không đúng.'
          : err instanceof Error
            ? err.message
            : 'Đăng nhập thất bại.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      role={role}
      title="Đăng nhập"
      subtitle="Dùng tài khoản doanh nghiệp của bạn để tiếp tục."
      footer={
        <>
          Chưa có tài khoản?{' '}
          <Link
            href={`/register?role=${role}`}
            className="font-semibold no-underline"
            style={{ color: `rgb(${meta.color})` }}
          >
            Đăng ký doanh nghiệp
          </Link>
          <span className="mx-2 text-white/25">·</span>
          <Link href="/" className="font-semibold text-white/60 no-underline hover:text-white/80">
            Đổi vai trò
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && <AuthError message={error} />}
        <AuthField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ban@congty.vn"
        />
        <AuthField
          label="Mật khẩu"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••••••"
        />
        <AuthField
          label="Mã tổ chức (tuỳ chọn)"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="vd. northwind-logistics"
          hint="Chỉ cần khi tài khoản thuộc nhiều tổ chức."
        />
        <div className="pt-2">
          <AuthSubmit busy={busy} color={meta.color}>
            Đăng nhập
          </AuthSubmit>
        </div>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
