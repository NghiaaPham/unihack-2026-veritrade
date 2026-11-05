/**
 * Business view of a parsed e-invoice.
 *
 * Deliberately narrow: it holds the fields VeriTrade needs for identity,
 * verification and financing, not a faithful copy of the document. A parser
 * that returns "the whole XML as an object" is not an abstraction, it is a
 * transport for whatever the sender chose to put in the file.
 */

export interface ParsedInvoiceParty {
  name: string;
  taxId: string;
}

export interface ParsedInvoiceHeader {
  /** Ký hiệu hoá đơn — invoice series, e.g. `C25TAA`. */
  series: string;
  /** Số hoá đơn — invoice number, e.g. `0000123`. */
  number: string;
  /** Ký hiệu mẫu số — template code, e.g. `1`. Part of the identity. */
  templateCode: string;
  /** Human-readable template name (`THDon`). Display only. */
  templateName: string | null;
  /** ISO `YYYY-MM-DD`. */
  issueDate: string;
  currency: string;
  paymentMethod: string | null;
}

export interface ParsedInvoiceTotals {
  /** Sum before tax, as a plain decimal string. Null when absent. */
  subtotal: string | null;
  /** Total tax, as a plain decimal string. Null when absent. */
  taxAmount: string | null;
  /** Grand total, as a plain decimal string. Always present. */
  total: string;
  totalInWords: string | null;
}

export interface ParsedInvoiceLineItem {
  lineNumber: string | null;
  description: string;
  unit: string | null;
  quantity: string | null;
  unitPrice: string | null;
  discount: string | null;
  lineTotal: string | null;
  taxRate: string | null;
}

export interface ParsedInvoiceSignatureInfo {
  /** True when at least one XMLDSig `<Signature>` element is present. */
  present: boolean;
  /** Number of `<Signature>` elements found. */
  count: number;
  /** True when a `<DSCKS>` (signature list) wrapper is present. */
  hasSignatureList: boolean;
}

export interface ParsedInvoice {
  /** Profile id that accepted the document, e.g. `TT78_2021`. */
  format: string;
  /** Version of the parser that produced this result. */
  parserVersion: string;
  seller: ParsedInvoiceParty;
  buyer: ParsedInvoiceParty;
  header: ParsedInvoiceHeader;
  totals: ParsedInvoiceTotals;
  lineItems: ParsedInvoiceLineItem[];
  signature: ParsedInvoiceSignatureInfo;
  /**
   * Non-fatal observations: an optional field that was absent, a value that
   * had to be normalised. Never contains document contents.
   */
  warnings: string[];
}
