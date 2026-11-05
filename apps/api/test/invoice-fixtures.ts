import { Prisma, type Invoice } from '../src/generated/prisma/client.js';

/**
 * A complete `Invoice` row, for tests that need the shape without a database.
 *
 * Every field is present rather than cast from a partial: a test fixture that
 * lies about the type will pass while the code under test reads `undefined`.
 */
export function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  const now = new Date('2026-09-01T08:00:00.000Z');

  return {
    id: '01930000-0000-7000-8000-000000000001',
    organizationId: '01930000-0000-7000-8000-0000000000aa',
    uploadedById: '01930000-0000-7000-8000-0000000000bb',
    invoiceNumber: '123',
    issuerTaxId: '0101234567',
    debtorTaxId: '0107654321',
    currency: 'VND',
    invoiceSeries: 'C25TAA',
    invoiceType: '1',
    invoiceTypeName: 'Hóa đơn giá trị gia tăng',
    sellerName: 'Công ty TNHH Vận tải Northwind',
    buyerName: 'Công ty Cổ phần Bán lẻ Minh Anh',
    amount: new Prisma.Decimal('1650000'),
    subtotalAmount: new Prisma.Decimal('1500000'),
    taxAmount: new Prisma.Decimal('150000'),
    issueDate: new Date('2026-09-01T00:00:00.000Z'),
    dueDate: null,
    status: 'SUBMITTED',
    fingerprint: 'a'.repeat(64),
    contentHash: 'b'.repeat(64),
    lastVerifiedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
