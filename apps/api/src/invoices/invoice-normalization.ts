/**
 * Normalisation rules shared by the parser, the fingerprint and the verifier.
 *
 * This module exists because those three must agree *exactly*. If the parser
 * stored "0000123" and the fingerprint hashed "123", the same invoice uploaded
 * twice would produce two identities and duplicate detection would silently
 * fail — the worst possible failure mode for this system. One implementation,
 * imported everywhere.
 *
 * It imports nothing, deliberately: `prisma/seed.ts` uses these rules and runs
 * under Node's type stripping, which cannot resolve the Prisma client's `.js`
 * specifiers. Decimal parsing lives in `invoice-amounts.ts` for that reason.
 */

/**
 * Tax identifiers keep their dashes.
 *
 * `0101234567` (head office) and `0101234567-001` (a branch) are different
 * legal entities. Stripping the dash would merge them into one identity, which
 * is why only whitespace and dots are removed.
 */
export function normalizeTaxId(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s.]/g, '')
    .replace(/[^0-9A-Z-]/g, '');
}

/** Invoice series (ký hiệu): uppercase, alphanumerics only. */
export function normalizeInvoiceSeries(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/[^0-9A-Z]/g, '');
}

/**
 * Invoice number (số hoá đơn).
 *
 * A purely numeric number loses its leading zeros: `0000123` and `123` are the
 * same invoice, and different providers pad differently. This cannot merge two
 * distinct invoices, because the number is unique within a seller + series —
 * the padded and unpadded forms cannot both exist.
 */
export function normalizeInvoiceNumber(value: string): string {
  const trimmed = value.trim().toUpperCase();

  if (/^\d+$/.test(trimmed)) {
    return trimmed.replace(/^0+(?=\d)/, '');
  }

  return trimmed.replace(/\s+/g, '');
}

/** Template code (ký hiệu mẫu số), e.g. `1`, `2`, `1C`. */
export function normalizeTemplateCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

/** ISO 4217 code. */
export function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;

/**
 * Extracts a calendar date from `YYYY-MM-DD` or a `YYYY-MM-DDTHH:mm:ss`
 * timestamp. Returns null when the value is not a real date.
 */
export function normalizeIsoDate(value: string): string | null {
  const match = ISO_DATE.exec(value.trim());

  if (match === null) {
    return null;
  }

  const [, year, month, day] = match as unknown as [string, string, string, string];
  const parsed = new Date(`${year}-${month}-${day}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  // Rejects 2026-02-31, which Date would silently roll into March.
  if (parsed.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

/** Collapses internal whitespace and trims. Used for names and descriptions. */
export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
