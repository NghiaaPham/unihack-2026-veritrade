import { Injectable } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception.js';
import {
  canonicalContent as canonicalContentOf,
  canonicalIdentity as canonicalIdentityOf,
  missingIdentityFields,
  sha256Hex,
  type InvoiceContent,
  type InvoiceIdentity,
} from './invoice-fingerprint.js';

export {
  CONTENT_PREFIX,
  FINGERPRINT_VERSION,
  IDENTITY_PREFIX,
  type InvoiceContent,
  type InvoiceIdentity,
} from './invoice-fingerprint.js';

/**
 * Invoice fingerprints, with the error mapping the HTTP layer needs.
 *
 * The hashing itself lives in `invoice-fingerprint.ts`, which imports nothing
 * but `node:crypto`. That split exists because `prisma/seed.ts` runs under
 * Node's type stripping, which cannot load a file containing decorators — and
 * the seed must use the same identity rule as the API, not a copy of it.
 */
@Injectable()
export class InvoiceFingerprintService {
  /**
   * Throws rather than hashing an incomplete identity. A fingerprint over a
   * missing field is not "a weaker fingerprint", it is a fingerprint that
   * collides with every other invoice missing the same field.
   */
  assertIdentityComplete(identity: InvoiceIdentity): void {
    const missing = missingIdentityFields(identity);

    if (missing.length > 0) {
      throw new AppException(
        422,
        'INCOMPLETE_INVOICE_IDENTITY',
        'The invoice identity is incomplete and cannot be fingerprinted',
        { missingFields: missing },
      );
    }
  }

  canonicalIdentity(identity: InvoiceIdentity): string {
    this.assertIdentityComplete(identity);

    return canonicalIdentityOf(identity);
  }

  identity(identity: InvoiceIdentity): string {
    return sha256Hex(this.canonicalIdentity(identity));
  }

  canonicalContent(content: InvoiceContent): string {
    return canonicalContentOf(content);
  }

  content(content: InvoiceContent): string {
    return sha256Hex(this.canonicalContent(content));
  }
}
