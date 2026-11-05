import { Injectable } from '@nestjs/common';
import { CHECK_KEYS, type CheckOutcome, type VerificationCheck } from './check.types.js';

/**
 * Is the signing certificate trusted?
 *
 * Separate from `signature.xmldsig` because they answer different questions.
 * A cryptographically valid signature only says "whoever holds this private
 * key signed this document". It says nothing about whether that key belongs to
 * the seller, whether the certificate was issued by a CA we trust, or whether
 * it had been revoked when the invoice was signed.
 *
 * Answering that requires a trust store of Vietnamese certificate authorities
 * plus revocation checking (OCSP/CRL). Neither is configured, so this reports
 * NOT_CHECKED rather than implying a trust decision that was never made.
 */
@Injectable()
export class SignatureTrustCheck implements VerificationCheck {
  readonly key = CHECK_KEYS.signatureTrust;
  readonly label = 'Signature certificate trust chain';

  async run(): Promise<CheckOutcome> {
    return {
      status: 'NOT_CHECKED',
      message:
        'No certificate trust store or revocation source is configured, so the signing certificate is not validated against a CA',
      details: { reason: 'NO_TRUST_STORE' },
    };
  }
}
