import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import {
  CHECK_KEYS,
  type CheckOutcome,
  type VerificationCheck,
  type VerificationInput,
} from './check.types.js';

/**
 * Is this invoice a duplicate of something already on file?
 *
 * Two different questions, both answered:
 *
 *   1. **Same identity.** There must be exactly one row with this fingerprint
 *      in the organisation. The unique constraint makes more than one
 *      impossible, so a count above one means the database was restored from
 *      inconsistent backups or a fingerprint was written by an older version —
 *      an integrity failure worth failing on.
 *
 *   2. **Same content, different identity.** Another invoice with identical
 *      buyer, amounts and issue date but a different series or number is the
 *      classic double-financing pattern: re-key the same receivable to get a
 *      second loan. It is a heuristic, not proof — two genuinely distinct
 *      invoices can coincide — but the cost of a false positive is a manual
 *      review, and the cost of a false negative is lending twice against one
 *      receivable. The check errs towards review.
 *
 * A matching invoice number alone is *not* treated as duplication: it is only
 * meaningful together with the seller and the series.
 */
@Injectable()
export class DuplicateCheck implements VerificationCheck {
  readonly key = CHECK_KEYS.duplicate;
  readonly label = 'Duplicate invoice detection';

  constructor(private readonly prisma: PrismaService) {}

  async run(input: VerificationInput): Promise<CheckOutcome> {
    const { invoice, organizationId } = input;

    const [sameIdentity, sameContent] = await Promise.all([
      this.prisma.invoice.count({
        where: { organizationId, fingerprint: invoice.fingerprint },
      }),
      this.prisma.invoice.count({
        where: {
          organizationId,
          contentHash: invoice.contentHash,
          id: { not: invoice.id },
        },
      }),
    ]);

    if (sameIdentity > 1) {
      return {
        status: 'FAILED',
        message: 'More than one invoice shares this identity inside the organisation',
        details: { sameIdentity, expected: 1 },
      };
    }

    if (sameIdentity === 0) {
      return {
        status: 'FAILED',
        message: 'The invoice could not be found by its own fingerprint',
        details: { sameIdentity },
      };
    }

    if (sameContent > 0) {
      return {
        status: 'FAILED',
        message:
          'Another invoice in this organisation has identical content under a different identity',
        details: { sameContentDifferentIdentity: sameContent },
      };
    }

    return {
      status: 'PASSED',
      message: 'No duplicate of this invoice exists in the organisation',
      details: { sameIdentity, sameContentDifferentIdentity: 0 },
    };
  }
}
