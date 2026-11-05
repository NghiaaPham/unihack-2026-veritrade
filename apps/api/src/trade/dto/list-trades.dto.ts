import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { tradeStatus, type TradeStatus } from '../../database/schema.js';

export class ListTradesQueryDto {
  @IsOptional()
  @IsIn(tradeStatus.enumValues)
  status?: TradeStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
