import {
  CONTENT_PREFIX,
  IDENTITY_PREFIX,
  InvoiceFingerprintService,
  type InvoiceContent,
  type InvoiceIdentity,
} from '../src/invoices/invoice-fingerprint.service.js';
import { AppException } from '../src/common/errors/app.exception.js';

const service = new InvoiceFingerprintService();

const identity: InvoiceIdentity = {
  sellerTaxId: '0101234567',
  series: 'C25TAA',
  number: '123',
  templateCode: '1',
};

const content: InvoiceContent = {
  buyerTaxId: '0107654321',
  buyerName: 'Công ty Cổ phần Bán lẻ Minh Anh',
  currency: 'VND',
  issueDate: '2026-09-01',
  subtotal: '1500000.000000000000000000',
  taxAmount: '150000.000000000000000000',
  total: '1650000.000000000000000000',
};

describe('Invoice fingerprint', () => {
  describe('determinism', () => {
    it('produces the same identity hash for the same input', () => {
      expect(service.identity(identity)).toBe(service.identity({ ...identity }));
    });

    it('produces a 64-character lowercase hex digest', () => {
      expect(service.identity(identity)).toMatch(/^[0-9a-f]{64}$/);
      expect(service.content(content)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('carries a versioned prefix in the canonical form', () => {
      // The prefix is inside the hash, so bumping it changes every fingerprint.
      // That is the point: a normalisation change must invalidate old hashes
      // loudly rather than silently.
      expect(service.canonicalIdentity(identity).startsWith(`${IDENTITY_PREFIX}|`)).toBe(true);
      expect(service.canonicalContent(content).startsWith(`${CONTENT_PREFIX}|`)).toBe(true);
    });

    it('contains no random or time-derived component', () => {
      // Calling it a thousand times must yield one value. A hash that included
      // an id or a timestamp would produce a different answer each time and
      // duplicate detection would never fire.
      const hashes = new Set(Array.from({ length: 1_000 }, () => service.identity(identity)));

      expect(hashes.size).toBe(1);
    });
  });

  describe('identity sensitivity', () => {
    const variants: ReadonlyArray<[string, InvoiceIdentity]> = [
      ['seller tax id', { ...identity, sellerTaxId: '0101234568' }],
      ['series', { ...identity, series: 'C25TAB' }],
      ['number', { ...identity, number: '124' }],
      ['template code', { ...identity, templateCode: '2' }],
    ];

    it.each(variants)('changes when the %s changes', (_label, variant) => {
      expect(service.identity(variant)).not.toBe(service.identity(identity));
    });

    it('does not collide when two fields swap content', () => {
      // The separator is what prevents `series=AB, number=12` and
      // `series=A, number=B12` from producing the same canonical string.
      const first = service.identity({ ...identity, series: 'AB', number: '12' });
      const second = service.identity({ ...identity, series: 'A', number: 'B12' });

      expect(first).not.toBe(second);
    });

    it('is independent of the content fields', () => {
      // Identity is computed from four fields only, so two submissions that
      // differ in amounts share a fingerprint. That is what makes a
      // conflicting re-submission detectable at all.
      expect(service.identity(identity)).toBe(service.identity({ ...identity }));
      expect(service.content(content)).not.toBe(
        service.content({ ...content, total: '1700000.000000000000000000' }),
      );
    });
  });

  describe('incomplete identity', () => {
    it.each(['sellerTaxId', 'series', 'number', 'templateCode'] as const)(
      'refuses to hash when %s is empty',
      (field) => {
        expect(() => service.identity({ ...identity, [field]: '   ' })).toThrow(AppException);
      },
    );

    it('reports the missing fields and a stable code', () => {
      try {
        service.identity({ sellerTaxId: '', series: '  ', number: '1', templateCode: '' });
        expect.unreachable('an incomplete identity must not be hashed');
      } catch (error) {
        expect(error).toBeInstanceOf(AppException);
        expect((error as AppException).getStatus()).toBe(422);
        expect((error as AppException).code).toBe('INCOMPLETE_INVOICE_IDENTITY');
        expect((error as AppException).details).toEqual({
          missingFields: ['sellerTaxId', 'series', 'templateCode'],
        });
      }
    });
  });

  describe('content sensitivity', () => {
    it('distinguishes an absent optional amount from a zero one', () => {
      // `?? ''` versus `'0'`: if these collided, an invoice with no tax line
      // and one with a zero tax line would look identical.
      const absent = service.content({ ...content, taxAmount: null });
      const zero = service.content({ ...content, taxAmount: '0' });

      expect(absent).not.toBe(zero);
    });

    it('changes when the buyer changes', () => {
      expect(service.content({ ...content, buyerTaxId: '0100000000' })).not.toBe(
        service.content(content),
      );
    });

    it('changes when the issue date changes', () => {
      expect(service.content({ ...content, issueDate: '2026-09-02' })).not.toBe(
        service.content(content),
      );
    });
  });
});
