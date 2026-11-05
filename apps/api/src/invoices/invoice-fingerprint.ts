import { createHash } from 'node:crypto';

/**
 * Versioned canonical representations.
 *
 * The prefix is part of the hash. Changing a normalisation rule without bumping
 * the version would silently change the identity of every invoice already
 * stored, so a re-upload would look like a brand-new invoice. Bumping the
 * prefix makes the change visible and forces a backfill to be planned.
 */
export const IDENTITY_PREFIX = 'vt-invoice-identity-v2';
export const CONTENT_PREFIX = 'vt-invoice-content-v1';

export const FINGERPRINT_VERSION = 'v2';

/**
 * The fields that legally identify an invoice.
 *
 * Per Vietnamese practice the identity of an invoice is the seller's tax code
 * plus the invoice series plus the invoice number, within a template type. Two
 * invoices with the same four values are the same invoice; two invoices that
 * differ in any of them are different invoices.
 *
 * Notably absent: the issue date, the buyer and the amounts. Those are
 * *content*. Putting them in the identity would let a re-issued invoice with a
 * corrected amount slip past duplicate detection as if it were a new document,
 * which is exactly the fraud this system exists to catch.
 */
export interface InvoiceIdentity {
  sellerTaxId: string;
  series: string;
  number: string;
  templateCode: string;
}

/**
 * The document-derived content that must agree for two submissions to be the
 * same invoice rather than two versions of it.
 *
 * Line-item detail is deliberately excluded: the structured-create path has no
 * line items, so including them would make the same invoice created two ways
 * look like a conflict. Amounts, parties and dates are what a financier
 * actually relies on.
 *
 * `dueDate` is excluded too: an e-invoice does not state payment terms, so it
 * is application metadata rather than document content.
 */
export interface InvoiceContent {
  buyerTaxId: string;
  buyerName: string;
  currency: string;
  issueDate: string;
  subtotal: string | null;
  taxAmount: string | null;
  total: string;
}

/**
 * Thrown instead of hashing an identity with a blank component.
 *
 * A plain `Error` subclass rather than an HTTP exception: this module has no
 * dependency on the framework, so the seed script can import it under Node's
 * type stripping. The service layer translates this into a 422.
 *
 * The fields are assigned explicitly rather than declared as constructor
 * parameter properties — Node's strip-only TypeScript mode does not support
 * them, and this file has to load there.
 */
export class IncompleteIdentityError extends Error {
  readonly missingFields: readonly string[];

  constructor(missingFields: readonly string[]) {
    super('The invoice identity is incomplete and cannot be fingerprinted');
    this.name = 'IncompleteIdentityError';
    this.missingFields = missingFields;
  }
}

const IDENTITY_FIELDS = ['sellerTaxId', 'series', 'number', 'templateCode'] as const;

/** The identity components that are blank, in a stable order. */
export function missingIdentityFields(identity: InvoiceIdentity): string[] {
  return IDENTITY_FIELDS.filter((field) => identity[field].trim().length === 0);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Anything with a fixed-point formatter — decimal.js, Prisma's `Decimal`, and
 * a test double all satisfy it.
 *
 * Declared structurally so this module does not import the Prisma client.
 * `prisma/seed.ts` loads under Node's type stripping, which cannot resolve the
 * generated client's `.js` specifiers, and the seed must hash amounts exactly
 * the way the API does.
 */
interface FixedDecimal {
  toFixed(fractionDigits: number): string;
}

/**
 * Canonical decimal string used inside hashes: fixed at 18 fraction digits.
 *
 * Without this, `1500000` and `1500000.00` would hash differently and the same
 * invoice would produce two content hashes depending on how it was formatted.
 */
export function canonicalAmount(value: FixedDecimal): string {
  return value.toFixed(18);
}

/**
 * Deterministic invoice identity.
 *
 * Determinism is the whole point: the same invoice uploaded twice, by two
 * different users, from two different exporters, must produce the same
 * fingerprint. Nothing random, nothing time-based, nothing derived from the
 * database — an id generated at insert time would make every upload unique and
 * duplicate detection meaningless.
 *
 * `vt-invoice-identity-v2|<seller>|<series>|<number>|<template>`.
 */
export function canonicalIdentity(identity: InvoiceIdentity): string {
  const missing = missingIdentityFields(identity);

  if (missing.length > 0) {
    throw new IncompleteIdentityError(missing);
  }

  return [
    IDENTITY_PREFIX,
    identity.sellerTaxId,
    identity.series,
    identity.number,
    identity.templateCode,
  ].join('|');
}

/** `vt-invoice-content-v1|<buyer>|<name>|<ccy>|<date>|<sub>|<tax>|<total>`. */
export function canonicalContent(content: InvoiceContent): string {
  return [
    CONTENT_PREFIX,
    content.buyerTaxId,
    content.buyerName,
    content.currency,
    content.issueDate,
    content.subtotal ?? '',
    content.taxAmount ?? '',
    content.total,
  ].join('|');
}
