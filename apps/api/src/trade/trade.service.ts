import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { isUniqueViolation } from '../database/prisma-errors.js';
import type { Trade } from '../generated/prisma/client.js';
import type { CreateTradeDto } from './dto/create-trade.dto.js';
import type { ListTradesQueryDto } from './dto/list-trades.dto.js';

const DEFAULT_CHAIN_ID = 43113;
const DEFAULT_LIMIT = 20;

export interface PaginatedTrades {
  data: Trade[];
  total: number;
}

@Injectable()
export class TradeService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTradeDto): Promise<Trade> {
    try {
      return await this.prisma.trade.create({
        data: {
          reference: dto.reference,
          // EVM addresses are case-insensitive; storing lowercase keeps the
          // checksummed and unchecksummed forms from becoming separate rows.
          buyerAddress: dto.buyerAddress.toLowerCase(),
          sellerAddress: dto.sellerAddress.toLowerCase(),
          asset: dto.asset,
          // Passed through as a string: converting to a JS number here would
          // lose precision beyond 15 significant digits.
          amount: dto.amount,
          chainId: dto.chainId ?? DEFAULT_CHAIN_ID,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`A trade with reference "${dto.reference}" already exists`);
      }
      throw error;
    }
  }

  async findMany(query: ListTradesQueryDto): Promise<PaginatedTrades> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const where = query.status === undefined ? {} : { status: query.status };

    // Batched transaction: the page and its total are read from the same
    // snapshot, so a concurrent insert cannot make `total` disagree with the
    // rows returned.
    const [data, total] = await this.prisma.$transaction([
      this.prisma.trade.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.trade.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: string): Promise<Trade> {
    const found = await this.prisma.trade.findUnique({ where: { id } });

    if (found === null) {
      throw new NotFoundException(`Trade ${id} not found`);
    }

    return found;
  }
}
