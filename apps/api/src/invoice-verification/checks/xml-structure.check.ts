import { Injectable } from '@nestjs/common';
import {
  CHECK_KEYS,
  type CheckOutcome,
  type VerificationCheck,
  type VerificationInput,
} from './check.types.js';

/**
 * Did the document parse as a supported e-invoice format?
 *
 * This is the gate for the checks that need document detail. It answers a
 * structural question only — a document that parses cleanly is not thereby
 * valid, correct, or approved by anyone.
 */
@Injectable()
export class XmlStructureCheck implements VerificationCheck {
  readonly key = CHECK_KEYS.xmlStructure;
  readonly label = 'XML structural validity';

  async run(input: VerificationInput): Promise<CheckOutcome> {
    if (input.xml === null) {
      return {
        status: 'SKIPPED',
        message:
          'The invoice was created from structured metadata and has no source document to parse',
      };
    }

    if (input.parseError !== null) {
      return {
        status: 'FAILED',
        message: input.parseError.message,
        details: { code: input.parseError.code },
      };
    }

    if (input.parsed === null) {
      return {
        status: 'ERROR',
        message: 'The document was supplied but never parsed; this is a service defect',
      };
    }

    return {
      status: 'PASSED',
      message: `Document parsed as ${input.parsed.format}`,
      details: {
        format: input.parsed.format,
        parserVersion: input.parsed.parserVersion,
        lineItemCount: input.parsed.lineItems.length,
        warnings: input.parsed.warnings,
      },
    };
  }
}
