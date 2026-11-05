import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { TradeStatus } from '../../generated/prisma/client.js';

const TRADE_STATUSES = Object.values(TradeStatus);

export class ListTradesQueryDto {
  @IsOptional()
  @IsIn(TRADE_STATUSES)
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
