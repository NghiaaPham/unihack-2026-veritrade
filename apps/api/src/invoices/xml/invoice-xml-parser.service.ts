import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  DocumentTooLargeException,
  InvalidInvoiceDocumentException,
  UnsupportedInvoiceFormatException,
} from '../../common/errors/app.exception.js';
import {
  normalizeCurrency,
  normalizeInvoiceNumber,
  normalizeInvoiceSeries,
  normalizeIsoDate,
  normalizeTaxId,
  normalizeTemplateCode,
  normalizeText,
} from '../invoice-normalization.js';
import { parseAmount } from '../invoice-amounts.js';
import {
  INVOICE_XML_PROFILES,
  findProfile,
  type InvoiceXmlProfile,
} from './invoice-xml.profiles.js';
import type { ParsedInvoice, ParsedInvoiceLineItem } from './invoice-xml.types.js';
import {
  countElements,
  firstText,
  measureTree,
  resolveAll,
  rootElementName,
  type XmlObject,
  type XmlValue,
} from './xml-node.js';

/**
 * Bumped whenever extraction or normalisation changes in a way that alters the
 * stored fields. Recorded per document so a re-parse can be scoped to the rows
 * that predate a fix.
 */
const PARSER_VERSION = '1.0.0';

/** Guards against deeply nested documents overflowing a traversal stack. */
const MAX_DEPTH = 32;
/** Guards against documents that are small in bytes but enormous in structure. */
const MAX_NODES = 20_000;

/**
 * Constructs that have no place in an e-invoice and are the usual vehicle for
 * XML attacks. Rejecting them before the parser sees the text is defence in
 * depth: `fast-xml-parser` already refuses external entities, but a document
 * with a DOCTYPE is not an invoice regardless of what the parser does with it.
 */
const FORBIDDEN_CONSTRUCTS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /<!DOCTYPE/i, reason: 'DOCTYPE declarations are not accepted' },
  { pattern: /<!ENTITY/i, reason: 'entity declarations are not accepted' },
  {
    pattern: /<\?xml-stylesheet/i,
    reason: 'stylesheet processing instructions are not accepted',
  },
  { pattern: /\bxi:include\b/i, reason: 'XInclude is not accepted' },
];

/** Fields without which an invoice has no usable identity or amount. */
const REQUIRED_FIELDS = [
  'series',
  'number',
  'templateCode',
  'issueDate',
  'currency',
  'sellerName',
  'sellerTaxId',
  'buyerName',
  'buyerTaxId',
  'total',
] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];

export interface ParseOptions {
  /** Hard byte ceiling, applied before any decoding or parsing. */
  maxBytes: number;
}

/**
 * Turns an uploaded e-invoice document into the narrow business view the rest
 * of the system works with.
 *
 * Security posture, in order of application:
 *   1. Byte ceiling before touching the content.
 *   2. Strict UTF-8 decoding — invalid sequences are an error, not replacement
 *      characters, because a silently mangled tax id is worse than a rejection.
 *   3. DOCTYPE / ENTITY / stylesheet / XInclude rejected by pattern.
 *   4. Well-formedness validated before any field access.
 *   5. Depth and node-count limits measured before the deep traversals.
 *
 * The parser never resolves external resources, never expands entities and
 * never evaluates anything from the document.
 */
@Injectable()
export class InvoiceXmlParserService {
  static readonly PARSER_VERSION = PARSER_VERSION;

  private readonly parser = new XMLParser({
    ignoreAttributes: true,
    // Providers prefix elements inconsistently; matching on the local name is
    // the only way one profile covers more than one vendor.
    removeNSPrefix: true,
    // Money and identifiers stay strings. Coercing to a JS number would lose
    // precision past 15 significant digits and strip leading zeros.
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    // Belt and braces alongside the pattern check above.
    processEntities: false,
    ignoreDeclaration: true,
  });

  parse(input: Buffer, options: ParseOptions): ParsedInvoice {
    this.assertSize(input, options.maxBytes);

    const text = this.decode(input);
    this.assertNoForbiddenConstructs(text);

    const tree = this.parseDocument(text);
    this.assertWithinLimits(tree);

    const profile = this.detectProfile(tree);
    const body = this.bodyOf(tree, profile);

    return this.extract(body, tree, profile);
  }

  private assertSize(input: Buffer, maxBytes: number): void {
    if (input.byteLength === 0) {
      throw new InvalidInvoiceDocumentException('The uploaded document is empty');
    }

    if (input.byteLength > maxBytes) {
      throw new DocumentTooLargeException(
        `The uploaded document exceeds the ${maxBytes} byte limit`,
        { maxBytes, receivedBytes: input.byteLength },
      );
    }
  }

  private decode(input: Buffer): string {
    try {
      // `fatal: true` makes invalid UTF-8 an error instead of a replacement
      // character. A corrupted tax id must not reach the database.
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(input);

      return decoded.replace(/^\uFEFF/, '');
    } catch {
      throw new InvalidInvoiceDocumentException('The document is not valid UTF-8');
    }
  }

  private assertNoForbiddenConstructs(text: string): void {
    for (const { pattern, reason } of FORBIDDEN_CONSTRUCTS) {
      if (pattern.test(text)) {
        throw new InvalidInvoiceDocumentException(reason, { construct: pattern.source });
      }
    }
  }

  private parseDocument(text: string): XmlObject {
    const validation = XMLValidator.validate(text, { allowBooleanAttributes: false });

    if (validation !== true) {
      throw new InvalidInvoiceDocumentException('The document is not well-formed XML', {
        line: validation.err.line,
        column: validation.err.col,
        reason: validation.err.code,
      });
    }

    let parsed: unknown;

    try {
      parsed = this.parser.parse(text);
    } catch {
      // The parser's own message can quote document content, so it is dropped.
      throw new InvalidInvoiceDocumentException('The document could not be parsed');
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new InvalidInvoiceDocumentException('The document has no root element');
    }

    return parsed as XmlObject;
  }

  private assertWithinLimits(tree: XmlObject): void {
    const { nodes, maxDepth } = measureTree(tree);

    if (maxDepth > MAX_DEPTH) {
      throw new InvalidInvoiceDocumentException(
        `The document nests deeper than ${MAX_DEPTH} levels`,
        { maxDepth },
      );
    }

    if (nodes > MAX_NODES) {
      throw new InvalidInvoiceDocumentException(
        `The document contains more than ${MAX_NODES} nodes`,
        { maxNodes: MAX_NODES },
      );
    }
  }

  private detectProfile(tree: XmlObject): InvoiceXmlProfile {
    const root = rootElementName(tree);

    if (root === null) {
      throw new InvalidInvoiceDocumentException('The document must have exactly one root element');
    }

    const profile = findProfile(tree);

    if (profile === null) {
      throw new UnsupportedInvoiceFormatException(
        'The document does not match any supported e-invoice format',
        {
          rootElement: root,
          supportedFormats: INVOICE_XML_PROFILES.map((entry) => entry.id),
        },
      );
    }

    return profile;
  }

  private bodyOf(tree: XmlObject, profile: InvoiceXmlProfile): XmlObject {
    const [body] = resolveAll(tree, profile.bodyPath);

    if (body === undefined || typeof body !== 'object' || Array.isArray(body)) {
      throw new InvalidInvoiceDocumentException(
        `The document is missing the invoice body expected by ${profile.id}`,
      );
    }

    return body;
  }

  private extract(body: XmlObject, tree: XmlObject, profile: InvoiceXmlProfile): ParsedInvoice {
    const { fields } = profile;

    const raw: Record<
      RequiredField | 'templateName' | 'paymentMethod' | 'subtotal' | 'taxAmount' | 'totalInWords',
      string | null
    > = {
      series: firstText(body, fields.series),
      number: firstText(body, fields.number),
      templateCode: firstText(body, fields.templateCode),
      templateName: firstText(body, fields.templateName),
      issueDate: firstText(body, fields.issueDate),
      currency: firstText(body, fields.currency),
      paymentMethod: firstText(body, fields.paymentMethod),
      sellerName: firstText(body, fields.sellerName),
      sellerTaxId: firstText(body, fields.sellerTaxId),
      buyerName: firstText(body, fields.buyerName),
      buyerTaxId: firstText(body, fields.buyerTaxId),
      subtotal: firstText(body, fields.subtotal),
      taxAmount: firstText(body, fields.taxAmount),
      total: firstText(body, fields.total),
      totalInWords: firstText(body, fields.totalInWords),
    };

    const missing = REQUIRED_FIELDS.filter((field) => raw[field] === null);

    if (missing.length > 0) {
      throw new InvalidInvoiceDocumentException('The document is missing required invoice fields', {
        missingFields: [...missing],
        format: profile.id,
      });
    }

    const issueDate = normalizeIsoDate(raw.issueDate!);

    if (issueDate === null) {
      throw new InvalidInvoiceDocumentException('The invoice issue date is not a valid date', {
        field: 'issueDate',
      });
    }

    const total = parseAmount(raw.total!);

    if (total === null) {
      throw new InvalidInvoiceDocumentException('The invoice total is not a valid amount', {
        field: 'total',
      });
    }

    const warnings: string[] = [];

    const subtotal = this.optionalAmount(raw.subtotal, 'subtotal', warnings);
    const taxAmount = this.optionalAmount(raw.taxAmount, 'taxAmount', warnings);

    if (raw.subtotal === null) {
      warnings.push('The document has no subtotal; the line-sum check will be skipped');
    }

    if (raw.taxAmount === null) {
      warnings.push('The document has no tax total; the subtotal-plus-tax check will be skipped');
    }

    const lineItems = this.extractLineItems(body, profile);

    if (lineItems.length === 0) {
      warnings.push('The document has no line items');
    }

    const signatureCount = countElements(tree, 'Signature');

    return {
      format: profile.id,
      parserVersion: PARSER_VERSION,
      seller: {
        name: normalizeText(raw.sellerName!),
        taxId: normalizeTaxId(raw.sellerTaxId!),
      },
      buyer: {
        name: normalizeText(raw.buyerName!),
        taxId: normalizeTaxId(raw.buyerTaxId!),
      },
      header: {
        series: normalizeInvoiceSeries(raw.series!),
        number: normalizeInvoiceNumber(raw.number!),
        templateCode: normalizeTemplateCode(raw.templateCode!),
        templateName: raw.templateName === null ? null : normalizeText(raw.templateName),
        issueDate,
        currency: normalizeCurrency(raw.currency!),
        paymentMethod: raw.paymentMethod === null ? null : normalizeText(raw.paymentMethod),
      },
      totals: {
        subtotal: subtotal === null ? null : subtotal.toString(),
        taxAmount: taxAmount === null ? null : taxAmount.toString(),
        total: total.toString(),
        totalInWords: raw.totalInWords === null ? null : normalizeText(raw.totalInWords),
      },
      lineItems,
      signature: {
        present: signatureCount > 0,
        count: signatureCount,
        hasSignatureList: countElements(tree, 'DSCKS') > 0,
      },
      warnings,
    };
  }

  private optionalAmount(
    raw: string | null,
    field: string,
    warnings: string[],
  ): Prisma.Decimal | null {
    if (raw === null) {
      return null;
    }

    const parsed = parseAmount(raw);

    if (parsed === null) {
      warnings.push(`The ${field} value is not a valid amount and was ignored`);
      return null;
    }

    return parsed;
  }

  private extractLineItems(body: XmlValue, profile: InvoiceXmlProfile): ParsedInvoiceLineItem[] {
    const { container, fields } = profile.lineItems;
    const nodes = resolveAll(body, container);

    return nodes.map((node) => ({
      lineNumber: firstText(node, fields.lineNumber),
      description: normalizeText(firstText(node, fields.description) ?? ''),
      unit: firstText(node, fields.unit),
      quantity: firstText(node, fields.quantity),
      unitPrice: firstText(node, fields.unitPrice),
      discount: firstText(node, fields.discount),
      lineTotal: firstText(node, fields.lineTotal),
      taxRate: firstText(node, fields.taxRate),
    }));
  }
}
