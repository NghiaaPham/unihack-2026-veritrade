'use client';

import Link from 'next/link';
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import type { Tone } from '@/lib/status';

/**
 * Shared primitives. Class strings and inline values are taken from the
 * reference console (docs/ui-reference.md) so a screen can be checked against
 * its screenshot; prefer composing these over new one-off styles.
 */

export const TONE_RGB: Record<Tone, string> = {
  primary: '90, 91, 235',
  success: '26, 158, 101',
  warning: '225, 163, 37',
  error: '196, 24, 72',
  neutral: '107, 114, 128',
};

const rgb = (tone: Tone, alpha?: number) =>
  alpha === undefined ? `rgb(${TONE_RGB[tone]})` : `rgba(${TONE_RGB[tone]}, ${alpha})`;

export const cardShadow = 'rgba(7, 1, 24, 0.06) 0px 1px 6px';

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ text */

export function SectionLabel({
  children,
  tone = 'primary',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <p
      className={cx('m-0 text-[10px] font-bold uppercase tracking-[0.12em]', className)}
      style={{ color: rgb(tone) }}
    >
      {children}
    </p>
  );
}

export function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'mb-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-lo',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h2 className="m-0 text-[24px] font-bold leading-tight tracking-[-0.6px] text-ink">
          {title}
        </h2>
        {subtitle && <p className="m-0 pt-1.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">{actions}</div>}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted no-underline transition-colors hover:text-ink"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
      {children}
    </Link>
  );
}

export function ArrowLink({
  href,
  children,
  tone = 'primary',
  className,
}: {
  href: string;
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cx(
        'inline-flex items-center gap-1.5 text-[11px] font-bold no-underline transition-colors hover:opacity-80',
        className,
      )}
      style={{ color: rgb(tone) }}
    >
      {children}
      <ArrowRight />
    </Link>
  );
}

export function ArrowRight({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/* ---------------------------------------------------------------- badges */

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-[3px] text-[10px] font-semibold whitespace-nowrap"
      style={{ background: rgb(tone, 0.08), color: rgb(tone) }}
    >
      <span
        className="inline-block h-[5px] w-[5px] rounded-full"
        style={{ background: rgb(tone) }}
      />
      {children}
    </span>
  );
}

/** Dot-less pill used inside tables. */
export function TablePill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-[3px] text-[10px] font-bold whitespace-nowrap"
      style={{ background: rgb(tone, 0.08), color: rgb(tone) }}
    >
      {children}
    </span>
  );
}

/** Bordered pill with a check icon, as in the compliance check list. */
export function OutlinePill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-[3px] text-[10px] font-bold whitespace-nowrap"
      style={{
        background: rgb(tone, 0.08),
        color: rgb(tone),
        border: `1px solid ${rgb(tone, 0.3)}`,
      }}
    >
      {children}
    </span>
  );
}

export function Tag({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={cx(
        'rounded-full border border-line bg-bg px-2.5 py-[3px] text-[10px] font-semibold',
        muted ? 'text-muted' : 'text-ink',
      )}
    >
      {children}
    </span>
  );
}

/* ----------------------------------------------------------------- cards */

export function Sparkline({ tone = 'primary' }: { tone?: Tone }) {
  return (
    <svg width="44" height="16" viewBox="0 0 44 16" fill="none" aria-hidden>
      <path
        d="M1 11c4 0 5-4 9-4s5 5 9 5 5-6 9-6 5 3 8 3 4-4 7-5"
        stroke={rgb(tone)}
        strokeOpacity="0.85"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="42" cy="4" r="1.8" fill={rgb(tone)} />
    </svg>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'primary',
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div
      className="overflow-hidden rounded-[20px] transition-all duration-150"
      style={{
        background: `radial-gradient(ellipse at 20% 0%, ${rgb(tone, 0.063)} 0%, transparent 55%), var(--color-surface)`,
        border: `1px solid ${rgb(tone, 0.157)}`,
        boxShadow: cardShadow,
      }}
    >
      <div
        style={{
          height: 4,
          background: `linear-gradient(90deg, ${rgb(tone)} 0%, ${rgb(tone, 0.8)} 50%, transparent 100%)`,
        }}
      />
      <div style={{ padding: '16px 20px 20px' }}>
        <div className="mb-3.5 flex items-start justify-between">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.11em]"
            style={{ color: rgb(tone) }}
          >
            {label}
          </span>
          <Sparkline tone={tone} />
        </div>
        <div
          className="text-[32px] font-medium leading-none tracking-[-1.5px] tabular-nums"
          style={{ color: rgb(tone), marginBottom: hint ? 14 : 0 }}
        >
          {value}
        </div>
        {hint && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted">{hint}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Large tinted card ("Next due", "Drawdowns available"). */
export function HighlightCard({
  label,
  value,
  title,
  caption,
  link,
  tone = 'primary',
  glowAt = '20%',
}: {
  label: ReactNode;
  value: ReactNode;
  title?: ReactNode;
  caption?: ReactNode;
  link?: { href: string; label: ReactNode };
  tone?: Tone;
  glowAt?: string;
}) {
  return (
    <div
      className="flex flex-col rounded-[20px] p-5 sm:p-6"
      style={{
        border: `1px solid ${rgb(tone, 0.157)}`,
        background: `radial-gradient(ellipse at ${glowAt} 0%, ${rgb(tone, 0.063)} 0%, transparent 55%), var(--color-surface)`,
        boxShadow: cardShadow,
      }}
    >
      <div
        className="text-[10px] font-bold uppercase tracking-[0.1em]"
        style={{ color: rgb(tone) }}
      >
        {label}
      </div>
      <div
        className="mt-2 text-3xl font-medium leading-none sm:text-4xl"
        style={{ color: rgb(tone), letterSpacing: -1 }}
      >
        {value}
      </div>
      {title && <div className="mt-3 text-sm text-muted">{title}</div>}
      {caption && <div className="mt-0.5 text-[11px] text-lo">{caption}</div>}
      {link && (
        <ArrowLink href={link.href} tone={tone} className="mt-4 self-start">
          {link.label}
        </ArrowLink>
      )}
    </div>
  );
}

/** White panel with border + soft shadow (detail page sections). */
export function Panel({
  children,
  className,
  as: Tag = 'article',
  style,
}: {
  children: ReactNode;
  className?: string;
  as?: 'article' | 'div' | 'section';
  style?: CSSProperties;
}) {
  return (
    <Tag
      className={cx('rounded-[20px] bg-surface p-6', className)}
      style={{ border: '1px solid var(--color-border)', boxShadow: cardShadow, ...style }}
    >
      {children}
    </Tag>
  );
}

/** Panel with a gradient strip on top (detail headers). */
export function TopStripPanel({
  children,
  tone = 'primary',
  strip = 5,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  strip?: number;
  className?: string;
}) {
  return (
    <div
      className={cx('relative overflow-hidden rounded-[20px] bg-surface', className)}
      style={{ border: '1px solid var(--color-border)', boxShadow: cardShadow }}
    >
      <div
        className="w-full"
        style={{
          height: strip,
          background: `linear-gradient(90deg, ${rgb(tone)} 0%, ${rgb(tone, 0.8)} 50%, transparent 100%)`,
        }}
      />
      {children}
    </div>
  );
}

export function Notice({ children, tone = 'primary' }: { children: ReactNode; tone?: Tone }) {
  return (
    <div
      className="rounded-xl px-4 py-3 text-xs font-medium"
      style={{
        background: rgb(tone, 0.08),
        color: rgb(tone),
        border: `1px solid ${rgb(tone, 0.2)}`,
      }}
    >
      {children}
    </div>
  );
}

/** Grey strip of 2–4 metrics separated by hairlines. */
export function MetricStrip({
  items,
}: {
  items: { label: ReactNode; value: ReactNode; tone?: Tone }[];
}) {
  return (
    <div
      className="grid overflow-hidden rounded-xl bg-surface2"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item, i) => (
        <div
          key={i}
          className="min-w-0 px-3.5 py-[11px]"
          style={i > 0 ? { borderLeft: '1px solid var(--color-border)' } : undefined}
        >
          <div className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
            {item.label}
          </div>
          <div
            className="truncate text-base font-bold"
            style={{ color: item.tone ? rgb(item.tone) : 'var(--color-ink)' }}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Label/value rows of the "Loan overview" card. */
export function KeyValueList({
  rows,
}: {
  rows: { label: ReactNode; value: ReactNode; aside?: ReactNode; tone?: Tone }[];
}) {
  return (
    <div className="flex flex-col">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-[11px]">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted">
            {row.label}
          </span>
          <span className="flex min-w-0 items-center gap-2 text-right">
            <span
              className="truncate text-sm font-semibold"
              style={{ color: row.tone ? rgb(row.tone) : 'var(--color-ink)' }}
            >
              {row.value}
            </span>
            {row.aside && <span className="shrink-0 text-[10px] text-muted">{row.aside}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Two-column label/value grid of the compliance detail sections. */
export function FieldGrid({
  fields,
}: {
  fields: { label: ReactNode; value: ReactNode; wide?: boolean }[];
}) {
  return (
    <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {fields.map((f, i) => (
        <div key={i} className={cx('min-w-0', f.wide && 'sm:col-span-2')}>
          <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted">
            {f.label}
          </div>
          <div className="break-words text-[13px] font-semibold text-ink">{f.value}</div>
        </div>
      ))}
    </div>
  );
}

export function ProgressBar({
  percent,
  tone = 'primary',
  height = 7,
  track,
}: {
  percent: number;
  tone?: Tone;
  height?: number;
  track?: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-full"
      style={{ height, background: track ?? rgb(tone, 0.08) }}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, percent))}%`, background: rgb(tone) }}
      />
    </div>
  );
}

/* --------------------------------------------------------------- buttons */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function PrimaryButton({ className, children, style, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex min-h-12 cursor-pointer items-center justify-center gap-1.5 rounded-full px-6 text-sm font-bold text-white transition-all disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      style={{
        background: rgb('primary'),
        boxShadow: 'rgba(90, 91, 235, 0.267) 0px 2px 8px',
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Compact primary pill used in headers and tables. */
export function SmallButton({ className, children, style, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-full px-5 text-xs font-bold text-white no-underline transition-all disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      style={{
        background: rgb('primary'),
        boxShadow: 'rgba(90, 91, 235, 0.267) 0px 2px 8px',
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function GhostButton({ className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-bold text-ink transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function MeshButton({ className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx('mesh-button min-h-12 cursor-pointer px-6 text-sm font-semibold', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ExternalPill({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-11 items-center justify-center rounded-full px-5 text-xs font-bold text-white no-underline transition-all"
      style={{ background: rgb('primary'), boxShadow: 'rgba(90, 91, 235, 0.267) 0px 2px 8px' }}
    >
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------ tabs */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl border border-line bg-bg p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[11px] font-bold transition-colors duration-100"
            style={{
              background: active ? rgb('primary') : 'transparent',
              color: active ? '#fff' : 'var(--color-ink)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Pill tabs with a soft background, as in the payments page ("Open / Calendar / History"). */
export function PillTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex gap-1 rounded-full border border-line bg-surface2 p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className="cursor-pointer rounded-full px-5 py-2 text-[13px] font-bold transition-colors"
            style={{
              background: active ? rgb('primary') : 'transparent',
              color: active ? '#fff' : 'var(--color-ink)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- table */

export function GridTable({
  columns,
  template,
  rows,
  empty,
}: {
  columns: ReactNode[];
  template: string;
  rows: ReactNode[][];
  empty?: ReactNode;
}) {
  return (
    <div
      className="overflow-hidden rounded-[14px] bg-surface"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <div
        className="hidden items-center border-b border-line bg-surface2 px-5 py-2.5 sm:grid sm:gap-2"
        style={{ gridTemplateColumns: template }}
      >
        {columns.map((c, i) => (
          <span key={i} className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted">
            {c}
          </span>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-xs text-muted">
          {empty ?? 'Chưa có dữ liệu.'}
        </div>
      ) : (
        rows.map((cells, r) => (
          <div
            key={r}
            className={cx(
              'flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 sm:grid sm:gap-2',
              r < rows.length - 1 && 'border-b border-line',
            )}
            style={{ gridTemplateColumns: template }}
          >
            {cells.map((cell, c) => (
              <div key={c} className="min-w-0">
                {cell}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- states */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center rounded-2xl bg-surface px-6 py-12 text-center"
      style={{ border: '1px dashed var(--color-line-strong)' }}
    >
      <p className="m-0 text-sm font-bold text-ink">{title}</p>
      {description && (
        <p className="m-0 mt-1.5 max-w-md text-xs leading-relaxed text-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <Notice tone="error">{message}</Notice>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-xl bg-surface2', className)} />;
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="animate-spin"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
