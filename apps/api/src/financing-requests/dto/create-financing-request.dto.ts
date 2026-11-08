import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

/** Decimal string: positive, no separators, at most 18 fraction digits (the column scale). */
const POSITIVE_AMOUNT = /^(?!0+(\.0+)?$)\d{1,20}(\.\d{1,18})?$/;

/**
 * Opens a financing request against a verified invoice.
 *
 * The organisation, the requester, the currency and the status are not accepted
 * here: the first two come from the verified token, the currency is the
 * invoice's own, and a new request is always `REQUESTED`.
 */
export class CreateFinancingRequestDto {
  @ApiProperty({ format: 'uuid', description: 'Invoice in the caller organization' })
  @IsUUID()
  invoiceId!: string;

  @ApiProperty({
    example: '1000000',
    description: 'Decimal string, at most the invoice amount. Never a JSON number.',
  })
  @IsString()
  @Matches(POSITIVE_AMOUNT, { message: 'requestedAmount must be a positive decimal string' })
  requestedAmount!: string;

  @ApiProperty({ minimum: 1, maximum: 365, example: 60, description: 'Days until repayment' })
  @IsInt()
  @Min(1)
  @Max(365)
  termDays!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 10000,
    example: 1200,
    description: 'Annualised rate in basis points (1 bps = 0.01%)',
  })
  @IsInt()
  @Min(0)
  @Max(10000)
  interestRateBps!: number;

  @ApiProperty({ minLength: 1, maxLength: 280, example: 'Vốn lưu động cho đơn hàng quý 4' })
  @IsString()
  @Length(1, 280)
  purpose!: string;
}
