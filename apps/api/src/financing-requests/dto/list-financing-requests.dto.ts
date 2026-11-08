import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { FinancingStatus } from '../../generated/prisma/client.js';

const FINANCING_STATUSES = Object.values(FinancingStatus);

/** List filters. The organisation is never a parameter: it comes from the token. */
export class ListFinancingRequestsQueryDto {
  @ApiPropertyOptional({ enum: FINANCING_STATUSES })
  @IsOptional()
  @IsIn(FINANCING_STATUSES)
  status?: FinancingStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

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
