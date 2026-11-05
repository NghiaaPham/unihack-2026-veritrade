import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { Trade } from '../database/schema.js';
import { CreateTradeDto } from './dto/create-trade.dto.js';
import { ListTradesQueryDto } from './dto/list-trades.dto.js';
import { TradeService, type PaginatedTrades } from './trade.service.js';

@Controller('trades')
export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  @Post()
  create(@Body() dto: CreateTradeDto): Promise<Trade> {
    return this.tradeService.create(dto);
  }

  @Get()
  list(@Query() query: ListTradesQueryDto): Promise<PaginatedTrades> {
    return this.tradeService.findMany(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Trade> {
    return this.tradeService.findById(id);
  }
}
