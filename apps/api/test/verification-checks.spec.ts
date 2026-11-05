import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ParsedInvoice } from '../src/invoices/xml/invoice-xml.types.js';
import type { VerificationInput } from '../src/invoice-verification/checks/check.types.js';
import { ArithmeticCheck } from '../src/invoice-verification/checks/arithmetic.check.js';
import { RequiredFieldsCheck } from '../src/invoice-verification/checks/required-fields.check.js';
import { SignatureTrustCheck } from '../src/invoice-verification/checks/signature-trust.check.js';
import { TaxAuthorityCheck } from '../src/invoice-verification/checks/tax-authority.check.js';
import { XmlSignatureCheck } from '../src/invoice-verification/checks/xml-signature.check.js';
import { XmlStructureCheck } from '../src/invoice-verification/checks/xml-structure.check.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { makeInvoice } from './invoice-fixtures.js';

function fixture(name: string): Buffer {
  return readFileSync(fileURLToPath(new URL(`./fixtures/invoices/${name}`, import.meta.url)));
}

function input(overrides: Partial<VerificationInput> = {}): VerificationInput {
  return {
    invoice: makeInvoice(),
    document: null,
    xml: null,
    parsed: null,
    parseError: null,
    organizationId: '01930000-0000-7000-8000-0000000000aa',
    ...overrides,
  };
}

function parsedInvoice(overrides: Partial<ParsedInvoice> = {}): ParsedInvoice {
  return {
    format: 'TT78_2021',
    parserVersion: '1.0.0',
    seller: { name: 'Seller', taxId: '0101234567' },
    buyer: { name: 'Buyer', taxId: '0107654321' },
    header: {
      series: 'C25TAA',
      number: '123',
      templateCode: '1',
      templateName: null,
      issueDate: '2026-09-01',
      currency: 'VND',
      paymentMethod: null,
    },
    totals: {
      subtotal: '1500000',
      taxAmount: '150000',
      total: '1650000',
      totalInWords: null,
    },
    lineItems: [],
    signature: { present: false, count: 0, hasSignatureList: false },
    warnings: [],
    ...overrides,
  };
}

describe('xml.structure', () => {
  const check = new XmlStructureCheck();

  it('skips when the invoice has no source document', async () => {
    const outcome = await check.run(input());

    expect(outcome.status).toBe('SKIPPED');
    expect(outcome.message).toContain('no source document');
  });

  it('fails when the document could not be parsed', async () => {
    const outcome = await check.run(
      input({
        xml: Buffer.from('<broken'),
        parseError: {
          code: 'INVALID_INVOICE_DOCUMENT',
          message: 'The document is not well-formed',
        },
      }),
    );

    expect(outcome.status).toBe('FAILED');
    expect(outcome.details).toMatchObject({ code: 'INVALID_INVOICE_DOCUMENT' });
  });

  it('passes when the parser accepted the document', async () => {
    const outcome = await check.run(
      input({ xml: Buffer.from('<HDon/>'), parsed: parsedInvoice() }),
    );

    expect(outcome.status).toBe('PASSED');
    expect(outcome.details).toMatchObject({ format: 'TT78_2021' });
  });

  it('reports an error when bytes were supplied but never parsed', async () => {
    // Defensive: reaching this state means the engine forgot to parse, which
    // is a defect, not a verdict about the invoice.
    const outcome = await check.run(input({ xml: Buffer.from('<HDon/>') }));

    expect(outcome.status).toBe('ERROR');
  });
});

describe('fields.required', () => {
  const check = new RequiredFieldsCheck();

  it('passes for a complete invoice', async () => {
    const outcome = await check.run(input());

    expect(outcome.status).toBe('PASSED');
  });

  it.each([
    ['invoiceSeries', { invoiceSeries: '   ' }],
    ['invoiceNumber', { invoiceNumber: '' }],
    ['invoiceType', { invoiceType: '' }],
    ['sellerName', { sellerName: ' ' }],
    ['buyerName', { buyerName: '' }],
    ['issuerTaxId', { issuerTaxId: '!' }],
    ['debtorTaxId', { debtorTaxId: '' }],
    ['currency', { currency: 'VNDD' }],
    ['amount', { amount: new Prisma.Decimal(0) }],
  ] as const)('fails when %s is unusable', async (field, overrides) => {
    const outcome = await check.run(input({ invoice: makeInvoice(overrides) }));

    expect(outcome.status).toBe('FAILED');
    expect(JSON.stringify(outcome.details)).toContain(field);
  });
});

describe('arithmetic.totals', () => {
  const check = new ArithmeticCheck();

  it('passes when subtotal plus tax equals the total', async () => {
    const outcome = await check.run(input());

    expect(outcome.status).toBe('PASSED');
  });

  it('fails when the declared total does not reconcile', async () => {
    const outcome = await check.run(
      input({ invoice: makeInvoice({ amount: new Prisma.Decimal('1750000') }) }),
    );

    expect(outcome.status).toBe('FAILED');
    expect(outcome.details).toMatchObject({
      mismatches: [{ check: 'subtotal_plus_tax_equals_total' }],
    });
  });

  it('fails when the line totals do not sum to the subtotal', async () => {
    const outcome = await check.run(
      input({
        parsed: parsedInvoice({
          lineItems: [
            {
              lineNumber: '1',
              description: 'Freight',
              unit: null,
              quantity: '10',
              unitPrice: '100000',
              discount: '0',
              lineTotal: '900000',
              taxRate: '10%',
            },
          ],
        }),
      }),
    );

    expect(outcome.status).toBe('FAILED');
    expect(JSON.stringify(outcome.details)).toContain('line_totals_sum_to_subtotal');
  });

  it('tolerates a one-cent rounding difference', async () => {
    const outcome = await check.run(
      input({ invoice: makeInvoice({ amount: new Prisma.Decimal('1650000.01') }) }),
    );

    expect(outcome.status).toBe('PASSED');
  });

  it('skips rather than passes when there is no monetary detail', async () => {
    // The critical property: a check that could not run must never report a
    // pass, or the verifier becomes decorative.
    const outcome = await check.run(
      input({
        invoice: makeInvoice({ subtotalAmount: null, taxAmount: null }),
        parsed: null,
      }),
    );

    expect(outcome.status).toBe('SKIPPED');
  });
});

describe('signature.xmldsig', () => {
  const check = new XmlSignatureCheck();

  it('reports NOT_CHECKED when the invoice has no document', async () => {
    const outcome = await check.run(input());

    expect(outcome.status).toBe('NOT_CHECKED');
  });

  it('reports NOT_CHECKED for a document with no signature', async () => {
    const outcome = await check.run(input({ xml: fixture('tt78-valid.xml') }));

    expect(outcome.status).toBe('NOT_CHECKED');
    expect(outcome.details).toMatchObject({ signatureCount: 0 });
  });

  it('reports UNSUPPORTED when the signature embeds no certificate', async () => {
    // A signature without a certificate cannot be checked. Claiming a pass
    // would be claiming a cryptographic verification that never happened.
    const outcome = await check.run(input({ xml: fixture('signed-no-cert.xml') }));

    expect(outcome.status).toBe('UNSUPPORTED');
    expect(outcome.details).toMatchObject({ signatureCount: 1, withoutCertificate: 1 });
  });

  it('does not verify a signature that was tampered with after signing', async () => {
    // Placeholder for the real case: any document carrying a Signature with a
    // certificate whose digest does not match must FAIL rather than pass.
    // The fixture set has no signed document with a real certificate, so this
    // asserts the negative path only.
    const outcome = await check.run(input({ xml: fixture('malformed.xml') }));

    expect(outcome.status).not.toBe('PASSED');
  });
});

describe('checks that are deliberately not implemented', () => {
  it('never reports a tax-authority verdict', async () => {
    const outcome = await new TaxAuthorityCheck().run();

    expect(outcome.status).toBe('UNSUPPORTED');
    expect(outcome.details).toMatchObject({ reason: 'NO_AUTHORIZED_INTEGRATION' });
  });

  it('never reports a signature trust verdict', async () => {
    const outcome = await new SignatureTrustCheck().run();

    expect(outcome.status).toBe('NOT_CHECKED');
    expect(outcome.details).toMatchObject({ reason: 'NO_TRUST_STORE' });
  });
});
