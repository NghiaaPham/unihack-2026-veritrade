import { Prisma } from '../generated/prisma/client.js';

/**
 * Parses a monetary value into a `Decimal`.
 *
 * Only plain decimals are accepted. Thousands separators are rejected rather
 * than guessed at: `1.100.000` is one hundred and one million under a
 * European reading and one point one under a Vietnamese one, and an invoice
 * system must not resolve that ambiguity by picking a favourite.
 *
 * Returns null for anything unparseable so callers can decide whether that is
 * a hard failure (required total) or a warning (optional subtotal).
 *
 * Kept apart from `invoice-normalization.ts` so that module stays free of the
 * Prisma client: `prisma/seed.ts` imports the string rules and runs under
 * Node's type stripping, which cannot resolve the generated client's `.js`
 * specifiers.
 */

const Decimal = Prisma.Decimal;

/** A plain decimal: optional sign, digits, optional fraction. No separators. */
const PLAIN_DECIMAL = /^[+-]?\d{1,24}(?:\.\d{1,18})?$/;

export function parseAmount(value: string): Prisma.Decimal | null {
  const trimmed = value.trim().replace(/\s/g, '');

  if (!PLAIN_DECIMAL.test(trimmed)) {
    return null;
  }

  try {
    const decimal = new Decimal(trimmed);

    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}
