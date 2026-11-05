import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

/** Same shape the Trade DTO uses: no separators, at most 18 fraction digits. */
const POSITIVE_AMOUNT = /^(?!0+(\.0+)?$)\d{1,20}(\.\d{1,18})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TAX_ID = /^[0-9A-Za-z][0-9A-Za-z-]{5,63}$/;
const SERIES = /^[0-9A-Za-z/._-]{1,32}$/;
const CURRENCY = /^[A-Za-z]{3}$/;

/**
 * Creates an invoice from structured metadata, without a source document.
 *
 * The invoice is still fingerprinted and still verified, but the checks that
 * need the document — structural validity and the XML signature — report
 * SKIPPED or NOT_CHECKED. That is visible in the verification result rather
 * than being papered over.
 */
export class CreateInvoiceDto {
  @ApiProperty({ example: 'C25TAA', maxLength: 32, description: 'Ký hiệu hoá đơn' })
  @IsString()
  @Matches(SERIES, { message: 'invoiceSeries contains unsupported characters' })
  invoiceSeries!: string;

  @ApiProperty({ example: '0000123', maxLength: 64, description: 'Số hoá đơn' })
  @IsString()
  @Length(1, 64)
  invoiceNumber!: string;

  @ApiProperty({ example: '1', maxLength: 16, description: 'Ký hiệu mẫu số' })
  @IsString()
  @Length(1, 16)
  invoiceType!: string;

  @ApiPropertyOptional({ example: 'Hóa đơn giá trị gia tăng', maxLength: 160 })
  @IsOptional()
  @IsString()
  @Length(1, 160)
  invoiceTypeName?: string;

  @ApiProperty({ example: 'Công ty TNHH Vận tải Northwind', maxLength: 255 })
  @IsString()
  @Length(1, 255)
  sellerName!: string;

  @ApiProperty({ example: '0101234567', maxLength: 64 })
  @IsString()
  @Matches(TAX_ID, { message: 'sellerTaxId is not a plausible tax code' })
  sellerTaxId!: string;

  @ApiProperty({ example: 'Công ty Cổ phần Bán lẻ Minh Anh', maxLength: 255 })
  @IsString()
  @Length(1, 255)
  buyerName!: string;

  @ApiProperty({ example: '0107654321', maxLength: 64 })
  @IsString()
  @Matches(TAX_ID, { message: 'buyerTaxId is not a plausible tax code' })
  buyerTaxId!: string;

  @ApiProperty({ example: 'VND', minLength: 3, maxLength: 3 })
  @IsString()
  @Matches(CURRENCY, { message: 'currency must be a 3-letter code' })
  currency!: string;

  @ApiProperty({ example: '1650000', description: 'Grand total, as a decimal string' })
  @IsString()
  @Matches(POSITIVE_AMOUNT, { message: 'amount must be a positive decimal string' })
  amount!: string;

  @ApiPropertyOptional({ example: '1500000', description: 'Sum before tax' })
  @IsOptional()
  @IsString()
  @Matches(POSITIVE_AMOUNT, { message: 'subtotalAmount must be a positive decimal string' })
  subtotalAmount?: string;

  @ApiPropertyOptional({ example: '150000', description: 'Total tax' })
  @IsOptional()
  @IsString()
  @Matches(POSITIVE_AMOUNT, { message: 'taxAmount must be a positive decimal string' })
  taxAmount?: string;

  @ApiProperty({ example: '2026-09-01', description: 'Issue date (YYYY-MM-DD)' })
  @IsString()
  @Matches(ISO_DATE, { message: 'issueDate must be a YYYY-MM-DD date' })
  issueDate!: string;

  @ApiPropertyOptional({ example: '2026-12-01', description: 'Due date (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'dueDate must be a YYYY-MM-DD date' })
  dueDate?: string;
}

/** Optional metadata accepted alongside a multipart upload. */
export class UploadInvoiceDto {
  @ApiPropertyOptional({ example: '2026-12-01', description: 'Due date (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'dueDate must be a YYYY-MM-DD date' })
  dueDate?: string;
}
