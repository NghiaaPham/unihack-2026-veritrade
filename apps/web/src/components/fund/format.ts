import { TONE_RGB } from '@/components/ui';
import type { Tone } from '@/lib/status';
import type { FinancingStatus } from '@/lib/types';

/** Basis points → "8,50%/năm", integer math only. */
export function formatRateBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = String(Math.abs(bps % 100)).padStart(2, '0');
  return `${whole},${frac}%/năm`;
}

export type ClaimAction = 'reserve' | 'declare-financed' | 'close' | 'cancel-reservation';

/** Mirrors the guards in docs/financing-state-machine.md §8. */
export const ALLOWED_STATES: Record<ClaimAction, FinancingStatus[]> = {
  reserve: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'RESERVED'],
  'declare-financed': ['RESERVED'],
  close: ['FINANCING_DECLARED'],
  'cancel-reservation': ['RESERVED'],
};

export function defaultAction(status: FinancingStatus): ClaimAction {
  if (status === 'RESERVED') return 'declare-financed';
  if (status === 'FINANCING_DECLARED') return 'close';
  return 'reserve';
}

export const toneRgb = (tone: Tone, alpha?: number) =>
  alpha === undefined ? `rgb(${TONE_RGB[tone]})` : `rgba(${TONE_RGB[tone]}, ${alpha})`;

export function stripGradient(tone: Tone): string {
  return `linear-gradient(90deg, ${toneRgb(tone)} 0%, ${toneRgb(tone, 0.8)} 50%, transparent 100%)`;
}

/** Lower-case and drop diacritics so "hoa don" matches "Hoá đơn". */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
