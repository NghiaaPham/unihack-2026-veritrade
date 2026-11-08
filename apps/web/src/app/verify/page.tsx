'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { DemoBar, Footer, Logo, LogoMark } from '@/components/shell';
import { ErrorBanner, Notice, SectionLabel, SmallButton, Spinner } from '@/components/ui';
import { HowItWorks } from '@/components/verify/how-it-works';
import {
  COMMITMENT_PATTERN,
  lookupCommitment,
  registryAddress,
  type RegistryLookup,
} from '@/components/verify/registry';
import { ResultCard } from '@/components/verify/result-card';

export default function VerifyPage() {
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [result, setResult] = useState<RegistryLookup | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const commitment = value.trim();
    if (!COMMITMENT_PATTERN.test(commitment)) {
      setFieldError('Mã cam kết phải gồm “0x” và 64 ký tự hex (0–9, a–f).');
      return;
    }
    setFieldError(null);
    setLookupError(null);
    setResult(null);
    setPending(true);
    try {
      setResult(await lookupCommitment(commitment as `0x${string}`));
    } catch {
      setLookupError(
        'Không đọc được contract qua RPC công khai. Kiểm tra kết nối mạng hoặc cấu hình RPC rồi thử lại.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DemoBar />
      <div className="flex min-h-screen flex-col bg-bg">
        <header className="sticky top-[var(--demo-bar-h,0px)] z-20 flex h-16 items-center justify-between border-b border-line bg-surface pr-5 lg:pr-8">
          <Logo product="VeriTrade" href="/" color="rgb(225, 163, 37)" />
          <Link
            href="/login"
            className="inline-flex min-h-9 items-center rounded-full border border-line bg-surface px-4 text-xs font-bold text-ink no-underline transition-colors hover:border-line-strong"
          >
            Đăng nhập
          </Link>
        </header>

        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1">
          <section className="px-5 py-6 lg:px-8 lg:py-8">
            <div className="mx-auto max-w-2xl pb-2 pt-2 lg:pb-6 lg:pt-6">
              <div className="flex flex-col items-center text-center">
                <LogoMark size={56} color="rgb(225, 163, 37)" />
                <div className="mt-5">
                  <SectionLabel>Kiểm chứng công khai</SectionLabel>
                </div>
                <h1 className="m-0 mt-2 text-[26px] font-bold tracking-[-0.5px] text-ink">
                  Hoá đơn này đã được tài trợ chưa?
                </h1>
                <p className="m-0 mt-2 max-w-md text-sm text-muted">
                  Bất kỳ ai cũng có thể hỏi trực tiếp contract registry trên Avalanche mà không cần tài
                  khoản. Dán mã cam kết của hoá đơn để xem trạng thái claim.
                </p>
              </div>

              {!registryAddress && (
                <div className="mt-8">
                  <Notice tone="warning">
                    Hợp đồng chưa được triển khai / cấu hình (NEXT_PUBLIC_VERITRADE_CONTRACT_ADDRESS).
                  </Notice>
                </div>
              )}

              <form onSubmit={submit} className="mx-auto mt-8 max-w-xl" noValidate>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="0x… (mã cam kết, 64 ký tự hex)"
                    aria-label="Mã cam kết"
                    aria-invalid={fieldError !== null}
                    spellCheck={false}
                    autoComplete="off"
                    className="min-h-11 w-full min-w-0 flex-1 rounded-full border border-line-strong bg-surface px-5 font-mono text-xs font-medium text-ink outline-none placeholder:font-sans placeholder:text-sm placeholder:text-muted focus:border-primary"
                  />
                  <SmallButton type="submit" disabled={!registryAddress || pending}>
                    {pending ? (
                      <>
                        <Spinner />
                        Đang tra cứu…
                      </>
                    ) : (
                      'Tra cứu'
                    )}
                  </SmallButton>
                </div>
                {fieldError && (
                  <p className="m-0 mt-2 px-5 text-xs font-medium text-error" role="alert">
                    {fieldError}
                  </p>
                )}
              </form>

              {(lookupError || result) && (
                <div className="mt-8">
                  {lookupError && <ErrorBanner message={lookupError} />}
                  {result && <ResultCard result={result} />}
                </div>
              )}
            </div>

            <div className="mx-auto mt-10 max-w-5xl">
              <HowItWorks />
            </div>
          </section>
        </main>
        <Footer />
      </div>
    </>
  );
}
