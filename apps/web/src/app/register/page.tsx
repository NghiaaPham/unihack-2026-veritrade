'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import {
  AuthCard,
  AuthError,
  AuthField,
  AuthSelect,
  AuthSubmit,
  parseRole,
  ROLE_META,
} from '@/components/auth-card';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const MIN_PASSWORD = 12;

function RegisterForm() {
  const params = useSearchParams();
  const role = parseRole(params.get('role'));
  const meta = ROLE_META[role];
  const router = useRouter();
  const { signIn } = useAuth();
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    password: '',
    organizationName: '',
    organizationCountry: 'VN',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form.password.length < MIN_PASSWORD) {
      setError(`Mật khẩu cần tối thiểu ${MIN_PASSWORD} ký tự.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.register({
        ...form,
        email: form.email.trim(),
        displayName: form.displayName.trim(),
        organizationName: form.organizationName.trim(),
      });
      signIn(result);
      router.replace(meta.home);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('Máy chủ đang tắt đăng ký tự do. Hãy liên hệ quản trị viên.');
      } else if (err instanceof ApiError && err.status === 409) {
        setError('Email này đã được đăng ký.');
      } else {
        setError(err instanceof Error ? err.message : 'Đăng ký thất bại.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      role={role}
      title="Đăng ký doanh nghiệp"
      subtitle="Tạo tài khoản và tổ chức của bạn. Bạn sẽ là chủ sở hữu tổ chức."
      footer={
        <>
          Đã có tài khoản?{' '}
          <Link href={`/login?role=${role}`} className="font-semibold no-underline" style={{ color: `rgb(${meta.color})` }}>
            Đăng nhập
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && <AuthError message={error} />}
        <AuthField label="Họ và tên" required value={form.displayName} onChange={set('displayName')} placeholder="Nguyễn Văn A" />
        <AuthField label="Email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} placeholder="ban@congty.vn" />
        <AuthField
          label="Mật khẩu"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          maxLength={200}
          value={form.password}
          onChange={set('password')}
          hint={`Tối thiểu ${MIN_PASSWORD} ký tự.`}
        />
        <AuthField label="Tên tổ chức" required value={form.organizationName} onChange={set('organizationName')} placeholder="Công ty TNHH ABC" />
        <AuthSelect label="Quốc gia" value={form.organizationCountry} onChange={set('organizationCountry')}>
          <option value="VN">Việt Nam</option>
          <option value="SG">Singapore</option>
          <option value="US">Hoa Kỳ</option>
          <option value="GB">Vương quốc Anh</option>
        </AuthSelect>
        <div className="pt-2">
          <AuthSubmit busy={busy} color={meta.color}>
            Tạo tài khoản
          </AuthSubmit>
        </div>
      </form>
    </AuthCard>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}
