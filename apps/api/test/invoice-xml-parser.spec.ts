import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { InvoiceXmlParserService } from '../src/invoices/xml/invoice-xml-parser.service.js';

const MAX_BYTES = 2_097_152;

const fixture = (name: string): Buffer =>
  readFileSync(fileURLToPath(new URL(`./fixtures/invoices/${name}`, import.meta.url)));

describe('InvoiceXmlParserService', () => {
  const parser = new InvoiceXmlParserService();
  const parse = (name: string) => parser.parse(fixture(name), { maxBytes: MAX_BYTES });

  describe('Thông tư 78/2021', () => {
    it('extracts the invoice identity', () => {
      const invoice = parse('tt78-valid.xml');

      expect(invoice.format).toBe('TT78_2021');
      expect(invoice.header).toMatchObject({
        series: 'C25TAA',
        number: '123',
        templateCode: '1',
        issueDate: '2026-09-01',
        currency: 'VND',
      });
    });

    it('extracts both parties', () => {
      const invoice = parse('tt78-valid.xml');

      expect(invoice.seller).toEqual({
        name: 'Công ty TNHH Vận tải Northwind',
        taxId: '0101234567',
      });
      expect(invoice.buyer).toEqual({
        name: 'Công ty Cổ phần Bán lẻ Minh Anh',
        taxId: '0107654321',
      });
    });

    it('keeps monetary values exact', () => {
      const invoice = parse('tt78-valid.xml');

      expect(invoice.totals).toMatchObject({
        subtotal: '1500000',
        taxAmount: '150000',
        total: '1650000',
      });
    });

    it('extracts line items in document order', () => {
      const invoice = parse('tt78-valid.xml');

      expect(invoice.lineItems).toHaveLength(2);
      expect(invoice.lineItems[0]).toMatchObject({
        lineNumber: '1',
        description: 'Vận chuyển hàng hóa',
        quantity: '10',
        unitPrice: '100000',
        lineTotal: '1000000',
      });
      expect(invoice.lineItems[1]).toMatchObject({
        description: 'Phí bốc xếp',
        lineTotal: '500000',
      });
    });

    it('reports the absence of a signature without failing', () => {
      const invoice = parse('tt78-valid.xml');

      expect(invoice.signature.present).toBe(false);
      expect(invoice.signature.count).toBe(0);
    });

    it('strips leading zeros from a numeric invoice number', () => {
      // The fixture says 0000123; the identity is the same invoice as 123.
      expect(parse('tt78-valid.xml').header.number).toBe('123');
    });
  });

  describe('Thông tư 32/2011', () => {
    it('recognises the wrapper-less structure as a different profile', () => {
      const invoice = parse('tt32-valid.xml');

      expect(invoice.format).toBe('TT32_2011');
      expect(invoice.header.series).toBe('AA/25E'.replace(/[/-]/g, ''));
      expect(invoice.totals.total).toBe('1080000');
    });

    it('normalises the series consistently with TT78', () => {
      // Slashes are not part of the identity: "AA/25E" and "AA25E" are the
      // same series as printed on the invoice.
      expect(parse('tt32-valid.xml').header.series).toBe('AA25E');
    });
  });

  describe('rejection paths', () => {
    it('rejects a document that is not well-formed', () => {
      expect(() => parse('malformed.xml')).toThrow(/not well-formed/);
    });

    it('rejects a well-formed document in an unsupported format', () => {
      expect(() => parse('ubl-unsupported.xml')).toThrow(/does not match any supported/);
    });

    it('rejects a DOCTYPE before the parser sees it', () => {
      expect(() => parse('xxe.xml')).toThrow(/DOCTYPE/);
    });

    it('rejects a document missing its identity fields', () => {
      let details: unknown;

      try {
        parse('missing-fields.xml');
      } catch (error) {
        details = (error as { getResponse: () => unknown }).getResponse();
      }

      expect(JSON.stringify(details)).toContain('missingFields');
      expect(JSON.stringify(details)).toContain('series');
      expect(JSON.stringify(details)).toContain('number');
    });

    it('rejects an empty upload', () => {
      expect(() => parser.parse(Buffer.alloc(0), { maxBytes: MAX_BYTES })).toThrow(/empty/);
    });

    it('rejects an oversized upload before parsing it', () => {
      const oversized = Buffer.concat([fixture('tt78-valid.xml'), Buffer.alloc(2048, 0x20)]);

      expect(() => parser.parse(oversized, { maxBytes: 1024 })).toThrow(/exceeds/);
    });

    it('rejects bytes that are not valid UTF-8', () => {
      const invalid = Buffer.from([0x3c, 0x48, 0xff, 0xfe, 0x3e]);

      expect(() => parser.parse(invalid, { maxBytes: MAX_BYTES })).toThrow(/UTF-8/);
    });

    it('rejects a document nested beyond the depth limit', () => {
      const deep = `<HDon>${'<a>'.repeat(40)}${'</a>'.repeat(40)}</HDon>`;

      expect(() => parser.parse(Buffer.from(deep), { maxBytes: MAX_BYTES })).toThrow(
        /nests deeper/,
      );
    });

    it('does not echo document content in the error', () => {
      try {
        parse('missing-fields.xml');
        throw new Error('expected the parser to throw');
      } catch (error) {
        const serialised = JSON.stringify((error as { getResponse: () => unknown }).getResponse());

        expect(serialised).not.toContain('Northwind');
        expect(serialised).not.toContain('0101234567');
      }
    });
  });

  describe('namespace handling', () => {
    it('matches elements regardless of prefix', () => {
      // Some providers emit prefixed elements, some a default namespace, some
      // none at all. The profile matches on the local name so all three
      // resolve to the same invoice.
      const prefixed = `<?xml version="1.0" encoding="UTF-8"?>
<ns0:HDon xmlns:ns0="urn:example:invoice">
  <ns0:DLHDon Id="INV-PREFIXED">
    <ns0:TTChung>
      <ns0:KHMSHDon>1</ns0:KHMSHDon>
      <ns0:KHHDon>C25TAA</ns0:KHHDon>
      <ns0:SHDon>0000123</ns0:SHDon>
      <ns0:NLap>2026-09-01</ns0:NLap>
      <ns0:DVTTe>VND</ns0:DVTTe>
    </ns0:TTChung>
    <ns0:NDHDon>
      <ns0:NBan><ns0:Ten>Seller</ns0:Ten><ns0:MST>0101234567</ns0:MST></ns0:NBan>
      <ns0:NMua><ns0:Ten>Buyer</ns0:Ten><ns0:MST>0107654321</ns0:MST></ns0:NMua>
      <ns0:TToan><ns0:TgTTTBSo>1650000</ns0:TgTTTBSo></ns0:TToan>
    </ns0:NDHDon>
  </ns0:DLHDon>
</ns0:HDon>`;

      const invoice = parser.parse(Buffer.from(prefixed), { maxBytes: MAX_BYTES });

      expect(invoice.format).toBe('TT78_2021');
      expect(invoice.header.number).toBe('123');
      expect(invoice.totals.total).toBe('1650000');
      expect(invoice.seller.taxId).toBe('0101234567');
    });
  });
});
