/** Matches the API's requestedAmount rule: positive, no separators, ≤ 18 fraction digits. */
const POSITIVE_AMOUNT = /^(?!0+(\.0+)?$)\d{1,20}(\.\d{1,18})?$/;

export function isPositiveAmount(value: string): boolean {
  return POSITIVE_AMOUNT.test(value);
}

/**
 * "12", "12.5" or "12,50" (percent per year) → integer basis points, parsed
 * from the string so no float arithmetic is involved. Null when invalid or > 100%.
 */
export function parsePercentToBps(input: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bps <= 10_000 ? bps : null;
}

/** 850 → "8,50%". */
export function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = String(bps % 100).padStart(2, '0');
  return `${whole},${fraction}%`;
}
