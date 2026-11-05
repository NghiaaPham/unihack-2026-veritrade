import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { parseAmount } from '../../invoices/invoice-amounts.js';
import {
  CHECK_KEYS,
  type CheckOutcome,
  type VerificationCheck,
  type VerificationInput,
} from './check.types.js';

const Decimal = Prisma.Decimal;

/**
 * Tolerance for a monetary comparison.
 *
 * One cent. Vietnamese invoices are normally whole dong, so this only absorbs
 * the rounding a line-level calculation can introduce; it is far too small to
 * hide a real discrepancy in a receivable.
 */
const TOLERANCE = new Decimal('0.01');

function equals(a: Prisma.Decimal, b: Prisma.Decimal): boolean {
  return a.minus(b).abs().lessThanOrEqualTo(TOLERANCE);
}

interface Mismatch {
  check: string;
  expected: string;
  actual: string;
}

/**
 * Does the money add up?
 *
 * Three independent relations, each skipped when its inputs are absent rather
 * than assumed to hold:
 *
 *   subtotal + tax          = total
 *   sum(line totals)        = subtotal
 *   qty × price − discount  = line total      (per line)
 *
 * A check that cannot be evaluated reports SKIPPED, never PASSED. Silently
 * passing on missing data is how a verifier becomes decorative.
 */
@Injectable()
export class ArithmeticCheck implements VerificationCheck {
  readonly key = CHECK_KEYS.arithmetic;
  readonly label = 'Financial arithmetic consistency';

  async run(input: VerificationInput): Promise<CheckOutcome> {
    const { invoice, parsed } = input;
    const mismatches: Mismatch[] = [];
    const evaluated: string[] = [];
    const skipped: string[] = [];

    const total = invoice.amount;
    const subtotal = invoice.subtotalAmount;
    const tax = invoice.taxAmount;

    if (subtotal !== null && tax !== null) {
      evaluated.push('subtotal_plus_tax_equals_total');

      const expected = subtotal.plus(tax);

      if (!equals(expected, total)) {
        mismatches.push({
          check: 'subtotal_plus_tax_equals_total',
          expected: expected.toFixed(2),
          actual: total.toFixed(2),
        });
      }
    } else {
      skipped.push('subtotal_plus_tax_equals_total');
    }

    const lineItems = parsed?.lineItems ?? [];

    if (subtotal !== null && lineItems.length > 0) {
      const lineTotals = lineItems.map((item) =>
        item.lineTotal === null ? null : parseAmount(item.lineTotal),
      );

      if (lineTotals.every((value) => value !== null)) {
        evaluated.push('line_totals_sum_to_subtotal');

        const sum = lineTotals.reduce<Prisma.Decimal>(
          (acc, value) => acc.plus(value as Prisma.Decimal),
          new Decimal(0),
        );

        if (!equals(sum, subtotal)) {
          mismatches.push({
            check: 'line_totals_sum_to_subtotal',
            expected: subtotal.toFixed(2),
            actual: sum.toFixed(2),
          });
        }
      } else {
        skipped.push('line_totals_sum_to_subtotal');
      }
    } else {
      skipped.push('line_totals_sum_to_subtotal');
    }

    // Per-line quantity × price − discount. Only evaluated when all four
    // values are present and numeric; otherwise the line is skipped.
    let lineLevelEvaluated = 0;

    for (const [index, item] of lineItems.entries()) {
      const quantity = item.quantity === null ? null : parseAmount(item.quantity);
      const unitPrice = item.unitPrice === null ? null : parseAmount(item.unitPrice);
      const discount = item.discount === null ? null : parseAmount(item.discount);
      const lineTotal = item.lineTotal === null ? null : parseAmount(item.lineTotal);

      if (quantity === null || unitPrice === null || lineTotal === null) {
        continue;
      }

      lineLevelEvaluated += 1;

      const expected = quantity.times(unitPrice).minus(discount ?? new Decimal(0));

      if (!equals(expected, lineTotal)) {
        mismatches.push({
          check: `line_${index + 1}_quantity_times_price`,
          expected: expected.toFixed(2),
          actual: lineTotal.toFixed(2),
        });
      }
    }

    if (lineLevelEvaluated > 0) {
      evaluated.push('line_quantity_times_price');
    } else {
      skipped.push('line_quantity_times_price');
    }

    if (mismatches.length > 0) {
      return {
        status: 'FAILED',
        message: 'The invoice totals do not reconcile',
        details: { mismatches, evaluated, skipped },
      };
    }

    if (evaluated.length === 0) {
      return {
        status: 'SKIPPED',
        message: 'There was not enough monetary detail to check the arithmetic',
        details: { skipped },
      };
    }

    return {
      status: 'PASSED',
      message: 'The invoice totals reconcile',
      details: { evaluated, skipped },
    };
  }
}
