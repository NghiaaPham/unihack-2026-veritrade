import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  Invoice,
  InvoiceDocument,
  VerificationCheckStatus,
  VerificationStatus,
} from '../generated/prisma/client.js';
import { AppException } from '../common/errors/app.exception.js';
import { InvoiceXmlParserService } from '../invoices/xml/invoice-xml-parser.service.js';
import type { ParsedInvoice } from '../invoices/xml/invoice-xml.types.js';
import {
  CHECK_KEYS,
  type CheckOutcome,
  type VerificationCheck,
  type VerificationInput,
} from './checks/check.types.js';

export const VERIFICATION_CHECKS = Symbol('VERIFICATION_CHECKS');

export interface VerificationCheckRecord {
  key: string;
  label: string;
  status: VerificationCheckStatus;
  message: string;
  details?: Record<string, unknown>;
  durationMs: number;
}

export interface VerificationRunResult {
  status: VerificationStatus;
  /**
   * Always `LOCAL_CHECKS_ONLY` for now. It exists so a client cannot read the
   * summary status and assume a legal determination was made.
   */
  scope: 'LOCAL_CHECKS_ONLY';
  checks: VerificationCheckRecord[];
  limitations: string[];
}

export interface VerificationRunInput {
  invoice: Invoice;
  document: InvoiceDocument | null;
  /** Raw document bytes, or null when the invoice has no source document. */
  xml: Buffer | null;
  organizationId: string;
  maxDocumentBytes: number;
}

/**
 * Runs every verification check and aggregates the verdict.
 *
 * Design rules that the aggregation enforces:
 *
 *   * A check that could not run never counts as a pass. `SKIPPED`,
 *     `UNSUPPORTED` and `NOT_CHECKED` all pull the summary down to `PARTIAL`.
 *   * Any `FAILED` or `ERROR` makes the summary `FAILED`, regardless of how
 *     many other checks passed.
 *   * `PASSED` therefore requires that every check actually ran and passed.
 *     Given that tax-authority verification is not implemented, no invoice can
 *     reach `PASSED` today — by design, not by accident.
 *
 * A check that throws is recorded as `ERROR` and does not abort the run: one
 * broken check must not hide the verdict of the others.
 */
@Injectable()
export class VerificationEngineService {
  private readonly logger = new Logger(VerificationEngineService.name);

  constructor(
    private readonly parser: InvoiceXmlParserService,
    @Inject(VERIFICATION_CHECKS) private readonly checks: readonly VerificationCheck[],
  ) {}

  async run(input: VerificationRunInput): Promise<VerificationRunResult> {
    const { parsed, parseError } = this.parseDocument(input);

    const checkInput: VerificationInput = {
      invoice: input.invoice,
      document: input.document,
      xml: input.xml,
      parsed,
      parseError,
      organizationId: input.organizationId,
    };

    const records: VerificationCheckRecord[] = [];

    for (const check of this.checks) {
      const startedAt = process.hrtime.bigint();
      let outcome: CheckOutcome;

      try {
        outcome = await check.run(checkInput);
      } catch (error) {
        this.logger.error(
          `Verification check ${check.key} threw`,
          error instanceof Error ? error.stack : String(error),
        );

        outcome = {
          status: 'ERROR',
          message: 'The check could not be completed',
        };
      }

      const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);

      records.push({
        key: check.key,
        label: check.label,
        status: outcome.status,
        message: outcome.message,
        ...(outcome.details === undefined ? {} : { details: outcome.details }),
        durationMs,
      });
    }

    return {
      status: this.aggregate(records),
      scope: 'LOCAL_CHECKS_ONLY',
      checks: records,
      limitations: this.collectLimitations(records),
    };
  }

  private parseDocument(input: VerificationRunInput): {
    parsed: ParsedInvoice | null;
    parseError: { code: string; message: string } | null;
  } {
    if (input.xml === null) {
      return { parsed: null, parseError: null };
    }

    try {
      return {
        parsed: this.parser.parse(input.xml, { maxBytes: input.maxDocumentBytes }),
        parseError: null,
      };
    } catch (error) {
      if (error instanceof AppException) {
        return { parsed: null, parseError: { code: error.code, message: error.message } };
      }

      return {
        parsed: null,
        parseError: { code: 'PARSE_FAILED', message: 'The document could not be parsed' },
      };
    }
  }

  private aggregate(records: readonly VerificationCheckRecord[]): VerificationStatus {
    if (records.some((record) => record.status === 'FAILED' || record.status === 'ERROR')) {
      return 'FAILED';
    }

    const incomplete = records.some(
      (record) =>
        record.status === 'SKIPPED' ||
        record.status === 'UNSUPPORTED' ||
        record.status === 'NOT_CHECKED',
    );

    return incomplete ? 'PARTIAL' : 'PASSED';
  }

  /**
   * Turns the non-passing checks into sentences a client can show a user.
   * Derived rather than hard-coded so a new check cannot silently omit its
   * limitation from the response.
   */
  private collectLimitations(records: readonly VerificationCheckRecord[]): string[] {
    const labels = new Map(this.checks.map((check) => [check.key, check.label]));

    return records
      .filter(
        (record) =>
          record.status === 'SKIPPED' ||
          record.status === 'UNSUPPORTED' ||
          record.status === 'NOT_CHECKED',
      )
      .map((record) => `${labels.get(record.key) ?? record.key}: ${record.message}`);
  }

  /** Exposed for the docs test that asserts the check inventory is stable. */
  static readonly CHECK_KEYS = CHECK_KEYS;
}
