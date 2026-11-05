import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import {
  CHECK_KEYS,
  type CheckOutcome,
  type VerificationCheck,
  type VerificationInput,
} from './check.types.js';

const CURRENCY = /^[A-Z]{3}$/;
/** Vietnamese tax codes are 10 digits, optionally followed by a 3-digit branch. */
const TAX_ID = /^[0-9A-Z][0-9A-Z-]{5,63}$/;

/**
 * Are the business fields that financing depends on actually present and
 * well-formed?
 *
 * Runs against the persisted row, not the parsed document: whatever bug let a
 * bad value reach the database is exactly the bug worth catching here.
 */
@Injectable()
export class RequiredFieldsCheck implements VerificationCheck {
  readonly key = CHECK_KEYS.requiredFields;
  readonly label = 'Required business fields';

  async run(input: VerificationInput): Promise<CheckOutcome> {
    const { invoice } = input;
    const problems: string[] = [];

    if (invoice.invoiceSeries.trim().length === 0) {
      problems.push('invoiceSeries is empty');
    }

    if (invoice.invoiceNumber.trim().length === 0) {
      problems.push('invoiceNumber is empty');
    }

    if (invoice.invoiceType.trim().length === 0) {
      problems.push('invoiceType is empty');
    }

    if (!TAX_ID.test(invoice.issuerTaxId)) {
      problems.push('issuerTaxId is not a plausible tax code');
    }

    if (!TAX_ID.test(invoice.debtorTaxId)) {
      problems.push('debtorTaxId is not a plausible tax code');
    }

    if (invoice.sellerName.trim().length === 0) {
      problems.push('sellerName is empty');
    }

    if (invoice.buyerName.trim().length === 0) {
      problems.push('buyerName is empty');
    }

    if (!CURRENCY.test(invoice.currency)) {
      problems.push('currency is not a 3-letter ISO code');
    }

    if (Number.isNaN(invoice.issueDate.getTime())) {
      problems.push('issueDate is not a valid date');
    }

    if (!invoice.amount.greaterThan(new Prisma.Decimal(0))) {
      problems.push('amount is not positive');
    }

    if (problems.length > 0) {
      return {
        status: 'FAILED',
        message: 'The invoice is missing or has invalid business fields',
        details: { problems },
      };
    }

    return {
      status: 'PASSED',
      message: 'All required business fields are present',
      details: {
        hasSubtotal: invoice.subtotalAmount !== null,
        hasTaxAmount: invoice.taxAmount !== null,
        hasDueDate: invoice.dueDate !== null,
      },
    };
  }
}
