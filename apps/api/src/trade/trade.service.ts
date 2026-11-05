import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { count, desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { trade, type Trade } from '../database/schema.js';
import type { CreateTradeDto } from './dto/create-trade.dto.js';
import type { ListTradesQueryDto } from './dto/list-trades.dto.js';

const DEFAULT_CHAIN_ID = 43113;
const DEFAULT_LIMIT = 20;

export interface PaginatedTrades {
  data: Trade[];
  total: number;
}

const UNIQUE_VIOLATION = '23505';
const MAX_CAUSE_DEPTH = 5;

/**
 * Postgres unique_violation. The code is not always on the thrown error:
 * Drizzle raises a DrizzleQueryError and keeps the driver error on `cause`.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }

    if ('code' in current && (current as { code?: unknown }).code === UNIQUE_VIOLATION) {
      return true;
    }

    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
  }

  return false;
}

@Injectable()
export class TradeService {
  constructor(private readonly database: DatabaseService) {}

  async create(dto: CreateTradeDto): Promise<Trade> {
    try {
      const [created] = await this.database.db
        .insert(trade)
        .values({
          reference: dto.reference,
          // EVM addresses are case-insensitive; storing lowercase keeps the
          // checksummed and unchecksummed forms from becoming separate rows.
          buyerAddress: dto.buyerAddress.toLowerCase(),
          sellerAddress: dto.sellerAddress.toLowerCase(),
          asset: dto.asset,
          amount: dto.amount,
          chainId: dto.chainId ?? DEFAULT_CHAIN_ID,
        })
        .returning();

      if (created === undefined) {
        throw new Error('Trade insert returned no row');
      }

      return created;
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
    const where = query.status === undefined ? undefined : eq(trade.status, query.status);

    const [data, totals] = await Promise.all([
      this.database.db
        .select()
        .from(trade)
        .where(where)
        .orderBy(desc(trade.createdAt))
        .limit(limit)
        .offset(offset),
      this.database.db.select({ total: count() }).from(trade).where(where),
    ]);

    return { data, total: totals[0]?.total ?? 0 };
  }

  async findById(id: string): Promise<Trade> {
    const [found] = await this.database.db.select().from(trade).where(eq(trade.id, id)).limit(1);

    if (found === undefined) {
      throw new NotFoundException(`Trade ${id} not found`);
    }

    return found;
  }
}
