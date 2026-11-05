import { IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

// Positive decimal, at most 20 integer digits and 18 fraction digits, so it
// always fits numeric(38,18). The lookahead rejects zero ("0", "0.00").
const POSITIVE_AMOUNT = /^(?!0+(\.0+)?$)\d{1,20}(\.\d{1,18})?$/;

export class CreateTradeDto {
  @IsString()
  @Length(1, 64)
  reference!: string;

  @Matches(EVM_ADDRESS, { message: 'buyerAddress must be a 0x-prefixed 20-byte address' })
  buyerAddress!: string;

  @Matches(EVM_ADDRESS, { message: 'sellerAddress must be a 0x-prefixed 20-byte address' })
  sellerAddress!: string;

  @IsString()
  @Length(1, 16)
  asset!: string;

  @Matches(POSITIVE_AMOUNT, {
    message: 'amount must be a positive decimal string with at most 18 fraction digits',
  })
  amount!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  chainId?: number;
}
