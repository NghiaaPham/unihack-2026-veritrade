import { Injectable } from '@nestjs/common';
import { CHECK_KEYS, type CheckOutcome, type VerificationCheck } from './check.types.js';

/**
 * Has the tax authority approved this invoice?
 *
 * There is no authorized integration with the Vietnamese tax authority's
 * invoice lookup service, so the honest answer is UNSUPPORTED. It is reported
 * on every run rather than omitted, because an absent check is indistinguishable
 * from a passed one to a client that only looks at the summary.
 *
 * A locally valid invoice — well-formed, arithmetically consistent, correctly
 * signed — is still not an invoice the tax authority has confirmed. Those are
 * independent facts and the system keeps them independent.
 */
@Injectable()
export class TaxAuthorityCheck implements VerificationCheck {
  readonly key = CHECK_KEYS.taxAuthority;
  readonly label = 'Tax authority verification';

  async run(): Promise<CheckOutcome> {
    return {
      status: 'UNSUPPORTED',
      message:
        'No authorized tax-authority integration is configured; the invoice has not been confirmed by the tax authority',
      details: { reason: 'NO_AUTHORIZED_INTEGRATION' },
    };
  }
}
