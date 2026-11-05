import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { InvoiceStatus } from '../../generated/prisma/client.js';

const INVOICE_STATUSES = Object.values(InvoiceStatus);
const SORT_FIELDS = ['createdAt', 'issueDate', 'amount'] as const;
const SORT_ORDERS = ['asc', 'desc'] as const;

export type InvoiceSortField = (typeof SORT_FIELDS)[number];
export type SortOrder = (typeof SORT_ORDERS)[number];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * List filters.
 *
 * `sortBy` is a closed union rather than a free string: it is mapped to a
 * Prisma `orderBy` object, so an arbitrary value would either be rejected at
 * runtime or, worse, silently ignored. An allowlist makes the contract
 * explicit and keeps the query builder injection-free.
 */
export class ListInvoicesQueryDto {
  @ApiPropertyOptional({ enum: INVOICE_STATUSES })
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: InvoiceStatus;

  @ApiPropertyOptional({ example: '0101234567' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  issuerTaxId?: string;

  @ApiPropertyOptional({ example: '0000123' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  invoiceNumber?: string;

  @ApiPropertyOptional({ example: '2026-01-01', description: 'Issue date lower bound' })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE)
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Issue date upper bound' })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE)
  to?: string;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: InvoiceSortField;

  @ApiPropertyOptional({ enum: SORT_ORDERS, default: 'desc' })
  @IsOptional()
  @IsIn(SORT_ORDERS)
  sortOrder?: SortOrder;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
