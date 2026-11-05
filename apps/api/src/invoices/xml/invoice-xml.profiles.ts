import { childrenOf, type XmlCandidates, type XmlObject, type XmlPath } from './xml-node.js';

/**
 * Supported e-invoice XML profiles.
 *
 * ## Why a profile registry instead of one parser
 *
 * "Vietnamese e-invoice XML" is not one schema. Thông tư 32/2011 and Thông tư
 * 78/2021 define different structures, and each provider (Viettel, VNPT, MISA,
 * BKAV...) ships its own serialisation with its own namespace prefixes and its
 * own optional elements. A parser that assumes one shape silently mis-reads the
 * others, which in an invoice system means wrong money.
 *
 * So each profile declares:
 *   * how to recognise a document (`matches`)
 *   * where the invoice body sits (`bodyPath`)
 *   * where each business field lives, as ordered candidates
 *
 * Adding a provider is a new profile object, not a new parser. Anything that
 * matches no profile is rejected as `UNSUPPORTED_INVOICE_FORMAT` rather than
 * being force-fitted into the nearest one.
 *
 * Element names are matched namespace-agnostically: the parser strips prefixes,
 * so `ns:HDon` and `HDon` both match `HDon`.
 */

export type InvoiceFieldKey =
  | 'series'
  | 'number'
  | 'templateCode'
  | 'templateName'
  | 'issueDate'
  | 'currency'
  | 'paymentMethod'
  | 'sellerName'
  | 'sellerTaxId'
  | 'buyerName'
  | 'buyerTaxId'
  | 'subtotal'
  | 'taxAmount'
  | 'total'
  | 'totalInWords';

export type LineItemFieldKey =
  | 'lineNumber'
  | 'description'
  | 'unit'
  | 'quantity'
  | 'unitPrice'
  | 'discount'
  | 'lineTotal'
  | 'taxRate';

export interface InvoiceXmlProfile {
  readonly id: string;
  readonly label: string;
  readonly rootElement: string;
  /** Path from the document root to the element holding the invoice fields. */
  readonly bodyPath: XmlPath;
  /** True when this profile recognises the document. */
  readonly matches: (root: XmlObject) => boolean;
  readonly fields: Readonly<Record<InvoiceFieldKey, XmlCandidates>>;
  readonly lineItems: {
    readonly container: XmlPath;
    readonly fields: Readonly<Record<LineItemFieldKey, XmlCandidates>>;
  };
}

const p = (...segments: string[]): XmlPath => segments;
const one = (...segments: string[]): XmlCandidates => [p(...segments)];

/**
 * The field map shared by both circulars: TT32 and TT78 kept the same element
 * names for the invoice body, and only the wrapper element changed.
 */
const COMMON_FIELDS: Readonly<Record<InvoiceFieldKey, XmlCandidates>> = {
  series: one('TTChung', 'KHHDon'),
  number: one('TTChung', 'SHDon'),
  templateCode: one('TTChung', 'KHMSHDon'),
  templateName: one('TTChung', 'THDon'),
  issueDate: one('TTChung', 'NLap'),
  currency: one('TTChung', 'DVTTe'),
  paymentMethod: one('TTChung', 'HTTToan'),
  sellerName: one('NDHDon', 'NBan', 'Ten'),
  sellerTaxId: one('NDHDon', 'NBan', 'MST'),
  buyerName: one('NDHDon', 'NMua', 'Ten'),
  buyerTaxId: one('NDHDon', 'NMua', 'MST'),
  subtotal: one('NDHDon', 'TToan', 'TgTCThue'),
  taxAmount: one('NDHDon', 'TToan', 'TgTThue'),
  total: one('NDHDon', 'TToan', 'TgTTTBSo'),
  totalInWords: one('NDHDon', 'TToan', 'TgTTTBChu'),
};

const COMMON_LINE_ITEM_FIELDS: Readonly<Record<LineItemFieldKey, XmlCandidates>> = {
  lineNumber: one('STT'),
  description: one('THHDVu'),
  unit: one('DVTinh'),
  quantity: one('SLuong'),
  unitPrice: one('DGia'),
  discount: one('TLCK'),
  lineTotal: one('ThTien'),
  taxRate: one('TSuat'),
};

/**
 * Thông tư 78/2021/TT-BTC — the current format.
 *
 * `<HDon><DLHDon>…` where `DLHDon` is "dữ liệu hoá đơn". This is the shape
 * Vietnamese tax-authority-issued invoices use today.
 */
export const TT78_2021: InvoiceXmlProfile = {
  id: 'TT78_2021',
  label: 'Thông tư 78/2021/TT-BTC',
  rootElement: 'HDon',
  bodyPath: p('HDon', 'DLHDon'),
  matches: (root) => childrenOf(root.HDon, 'DLHDon').length > 0,
  fields: COMMON_FIELDS,
  lineItems: {
    container: p('NDHDon', 'DSHHDVu', 'HHDVu'),
    fields: COMMON_LINE_ITEM_FIELDS,
  },
};

/**
 * Thông tư 32/2011/TT-BTC — the superseded format.
 *
 * Same field names, but the body sits directly under `<HDon>` with no
 * `DLHDon` wrapper. Still encountered for archived invoices, which is why it
 * is supported rather than rejected.
 */
export const TT32_2011: InvoiceXmlProfile = {
  id: 'TT32_2011',
  label: 'Thông tư 32/2011/TT-BTC',
  rootElement: 'HDon',
  bodyPath: p('HDon'),
  matches: (root) => childrenOf(root.HDon, 'DLHDon').length === 0,
  fields: COMMON_FIELDS,
  lineItems: {
    container: p('NDHDon', 'DSHHDVu', 'HHDVu'),
    fields: COMMON_LINE_ITEM_FIELDS,
  },
};

/**
 * Evaluated in order; the first profile whose `matches` returns true wins.
 * `TT78_2021` must stay first because it is the more specific of the two.
 */
export const INVOICE_XML_PROFILES: readonly InvoiceXmlProfile[] = [TT78_2021, TT32_2011];

export function findProfile(root: XmlObject): InvoiceXmlProfile | null {
  for (const profile of INVOICE_XML_PROFILES) {
    // The root element must be present before `matches` is meaningful: TT32
    // matches "no DLHDon", which is also true of a document with no HDon at
    // all. Checking presence first keeps that from being a false positive.
    if (!(profile.rootElement in root)) {
      continue;
    }

    if (profile.matches(root)) {
      return profile;
    }
  }

  return null;
}
