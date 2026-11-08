'use client';

import { useState, type ReactNode } from 'react';
import { SectionLabel, Sparkline, TONE_RGB, cardShadow } from '@/components/ui';
import { formatDate } from '@/lib/format';
import type { Tone } from '@/lib/status';

const solid = (tone: Tone) => `rgb(${TONE_RGB[tone]})`;
const alpha = (tone: Tone, a: number) => `rgba(${TONE_RGB[tone]}, ${a})`;

/** Relative "x phút trước" up to a week, then a calendar date. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days} ngày trước` : formatDate(iso);
}

/** Bordered chip for statuses, formats and check results (Defactor "506(b)" / "Verified"). */
export function OutlineChip({
  tone,
  soft,
  children,
}: {
  tone: Tone;
  /** Lighter fill, used for the format chip next to a status chip. */
  soft?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap"
      style={{
        borderColor: alpha(tone, soft ? 0.333 : 0.4),
        background: alpha(tone, soft ? 0.07 : 0.12),
        color: solid(tone),
      }}
    >
      {children}
    </span>
  );
}

/** Stat card of the compliance list: value plus a small ▲ pill. */
export function PillStatCard({
  label,
  value,
  pill,
  pillTone = 'primary',
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  pill: ReactNode;
  pillTone?: Tone;
  hint?: ReactNode;
}) {
  const tone: Tone = 'primary';
  return (
    <div
      className="overflow-hidden rounded-[20px] transition-all duration-150"
      style={{
        background: `radial-gradient(ellipse at 20% 0%, ${alpha(tone, 0.063)} 0%, transparent 55%), var(--color-surface)`,
        border: `1px solid ${alpha(tone, 0.157)}`,
        boxShadow: cardShadow,
      }}
    >
      <div
        style={{
          height: 4,
          background: `linear-gradient(90deg, ${solid(tone)} 0%, ${alpha(tone, 0.8)} 50%, transparent 100%)`,
        }}
      />
      <div style={{ padding: '16px 20px 20px' }}>
        <div className="mb-3.5 flex items-start justify-between">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.11em]"
            style={{ color: solid(tone) }}
          >
            {label}
          </span>
          <Sparkline tone={tone} />
        </div>
        <div
          className="mb-3.5 text-[32px] font-medium leading-none tracking-[-1.5px] tabular-nums"
          style={{ color: solid(tone) }}
        >
          {value}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-[3px] rounded-full px-[9px] py-[3px] text-[11px] font-bold"
            style={{ background: alpha(pillTone, 0.086), color: solid(pillTone) }}
          >
            <span className="text-[8px]">▲</span>
            {pill}
          </span>
          {hint && <span className="text-[11px] text-muted">{hint}</span>}
        </div>
      </div>
    </div>
  );
}

/** Detail-page section card: label + body (Defactor compliance sections). */
export function DetailPanel({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-[20px] bg-surface p-5 sm:p-6"
      style={{ border: '1px solid var(--color-border)', boxShadow: cardShadow }}
    >
      <SectionLabel>{title}</SectionLabel>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export function DetailGrid({
  fields,
}: {
  fields: { label: ReactNode; value: ReactNode; wide?: boolean }[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((f, i) => (
        <div key={i} className={f.wide ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-lo">{f.label}</div>
          <div className="mt-1 break-words text-sm font-semibold text-ink">{f.value}</div>
        </div>
      ))}
    </div>
  );
}

export function StatusIcon({ tone, kind }: { tone: Tone; kind: 'ok' | 'fail' | 'idle' }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={solid(tone)}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="10" />
      {kind === 'ok' && <path d="m9 12 2 2 4-4" />}
      {kind === 'fail' && <path d="m15 9-6 6M9 9l6 6" />}
      {kind === 'idle' && <path d="M8 12h8" />}
    </svg>
  );
}

export function RefreshIcon({ size = 12, spinning }: { size?: number; spinning?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={spinning ? 'animate-spin' : undefined}
    >
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

/** Short hash with a copy button; the full value is in the tooltip. */
export function CopyHash({ value, short }: { value: string; short: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-xs" title={value}>
        {short}
      </span>
      <button
        type="button"
        onClick={copy}
        className="cursor-pointer rounded-full border border-line px-2 py-0.5 text-[10px] font-bold text-muted transition-colors hover:bg-surface2"
      >
        {copied ? 'Đã chép' : 'Chép'}
      </button>
    </span>
  );
}
