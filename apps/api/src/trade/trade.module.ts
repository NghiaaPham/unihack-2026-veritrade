import { Module } from '@nestjs/common';
import { TradeController } from './trade.controller.js';
import { TradeService } from './trade.service.js';

@Module({
  controllers: [TradeController],
  providers: [TradeService],
  exports: [TradeService],
})
export class TradeModule {}
