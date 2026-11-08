/**
 * Vietnamese display formatting. Amounts arrive as decimal strings and are
 * formatted from the string (Intl.NumberFormat v3 accepts numeric strings), so
 * no amount is ever converted to a JS number.
 */

type NumericString = `${number}`;

function asNumericString(value: string): NumericString {
  return value as NumericString;
}

export function formatMoney(amount: string | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  try {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'VND' ? 0 : 2,
    }).format(asNumericString(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Compact form for stat cards: "48,3 N US$", "1,2 Tr ₫". */
export function formatMoneyCompact(amount: string | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  try {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(asNumericString(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(n);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(iso),
  );
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

export function formatLongDate(date: Date): string {
  const s = new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function greeting(date: Date): string {
  const h = date.getHours();
  if (h < 11) return 'Chào buổi sáng';
  if (h < 13) return 'Chào buổi trưa';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

export function shortHash(hash: string | null | undefined, head = 6, tail = 4): string {
  if (!hash) return '—';
  if (hash.length <= head + tail + 2) return hash;
  return `${hash.slice(0, head + 2)}…${hash.slice(-tail)}`;
}

export function daysUntil(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now.getTime();
  return Math.ceil(ms / 86_400_000);
}

export function relativeDays(iso: string | null | undefined): string | null {
  const d = daysUntil(iso);
  if (d === null) return null;
  if (d > 0) return `Đến hạn sau ${d} ngày`;
  if (d === 0) return 'Đến hạn hôm nay';
  return `Quá hạn ${-d} ngày`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
