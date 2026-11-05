import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decodeEventLog, type Log } from 'viem';

import { PrismaService } from '../database/prisma.service.js';
import { BlockchainEventType, Prisma, type ChainSyncCursor } from '../generated/prisma/client.js';
import { AvalancheRpcService, type RpcPublicClient } from './avalanche-rpc.service.js';
import { MAX_BLOCK_RANGE, REGISTRY_ABI } from './blockchain.constants.js';

export interface IndexerResult {
  fromBlock: string | null;
  toBlock: string | null;
  indexed: number;
  skipped: number;
  reorged: boolean;
}

const EVENT_TYPES: Record<string, BlockchainEventType> = {
  InvoiceReserved: BlockchainEventType.INVOICE_RESERVED,
  FinancingDeclared: BlockchainEventType.FINANCING_DECLARED,
  ReservationCancelled: BlockchainEventType.RESERVATION_CANCELLED,
  ClaimClosed: BlockchainEventType.CLAIM_CLOSED,
};

/**
 * Reads registry events into the database.
 *
 * Three properties matter more than throughput:
 *
 *   * **bounded ranges** — a first run against a public RPC must not ask for
 *     the whole chain, so the span per call is capped;
 *   * **idempotence** — the unique key is `(chainId, txHash, logIndex)`, so a
 *     replay after a crash inserts nothing twice;
 *   * **reorg awareness** — the cursor stores the hash of the block it reached.
 *     If that hash changes, the events from that height are deleted and the
 *     cursor steps back before anything new is appended.
 */
@Injectable()
export class BlockchainEventIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BlockchainEventIndexerService.name);
  private readonly intervalMs: number;
  private readonly confirmations: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: AvalancheRpcService,
    config: ConfigService,
  ) {
    this.intervalMs = config.get<number>('BLOCKCHAIN_INDEXER_INTERVAL_MS') ?? 0;
    this.confirmations = config.get<number>('BLOCKCHAIN_CONFIRMATIONS') ?? 1;
  }

  onModuleInit(): void {
    if (this.intervalMs <= 0 || !this.rpc.configured) return;

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    // Do not keep the process alive purely for the indexer.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    // Overlapping runs would race on the cursor; a skipped interval is cheaper
    // than a lock and the next tick catches up anyway.
    if (this.running) return;
    this.running = true;

    try {
      const result = await this.syncOnce();
      if (result.indexed > 0 || result.reorged) {
        this.logger.log(
          `indexed ${result.indexed} event(s) ${result.fromBlock ?? '-'}..${result.toBlock ?? '-'}` +
            (result.reorged ? ' (reorg detected)' : ''),
        );
      }
    } catch (error) {
      this.logger.warn(
        `event indexing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * One bounded pass. Safe to call from anywhere — the test suite uses it
   * directly instead of waiting for a timer.
   */
  async syncOnce(): Promise<IndexerResult> {
    const contractAddress = this.rpc.requireContractAddress();
    const chainId = this.rpc.chainId;
    const publicClient = this.rpc.publicClient();

    const cursor = await this.prisma.chainSyncCursor.upsert({
      where: { chainId_contractAddress: { chainId, contractAddress } },
      create: { chainId, contractAddress, lastProcessedBlock: 0n },
      update: {},
    });

    const empty: IndexerResult = {
      fromBlock: null,
      toBlock: null,
      indexed: 0,
      skipped: 0,
      reorged: false,
    };

    if (await this.rewindIfReorged(cursor, publicClient)) {
      return { ...empty, reorged: true };
    }

    const latest = BigInt(await publicClient.getBlockNumber());
    const safeLatest = latest - BigInt(Math.max(0, this.confirmations - 1));
    const from = cursor.lastProcessedBlock + 1n;

    if (from > safeLatest) return empty;

    const to =
      from + BigInt(MAX_BLOCK_RANGE - 1) < safeLatest
        ? from + BigInt(MAX_BLOCK_RANGE - 1)
        : safeLatest;

    const logs = await publicClient.getLogs({
      address: contractAddress,
      fromBlock: from,
      toBlock: to,
    });

    const rows = logs.flatMap((log) => this.toRow(log, chainId, contractAddress));

    let indexed = 0;
    if (rows.length > 0) {
      // The unique index turns a replay into a no-op instead of an error, and
      // the returned count is what was actually written — not what was seen.
      const written = await this.prisma.blockchainEvent.createMany({
        data: rows,
        skipDuplicates: true,
      });
      indexed = written.count;
    }

    const lastBlock = await publicClient.getBlock({ blockNumber: to });
    await this.prisma.chainSyncCursor.update({
      where: { chainId_contractAddress: { chainId, contractAddress } },
      data: { lastProcessedBlock: to, lastProcessedBlockHash: lastBlock.hash },
    });

    return {
      fromBlock: from.toString(),
      toBlock: to.toString(),
      indexed,
      skipped: logs.length - indexed,
      reorged: false,
    };
  }

  /**
   * Detects that the block we stopped at is no longer canonical.
   *
   * One step back per call: a deep reorg is walked out over several passes,
   * which keeps each pass cheap and keeps the deletion bounded.
   */
  private async rewindIfReorged(
    cursor: ChainSyncCursor,
    publicClient: RpcPublicClient,
  ): Promise<boolean> {
    if (cursor.lastProcessedBlock === 0n || cursor.lastProcessedBlockHash === null) {
      return false;
    }

    const block = await publicClient
      .getBlock({ blockNumber: cursor.lastProcessedBlock })
      .catch(() => null);

    if (block !== null && block.hash === cursor.lastProcessedBlockHash) return false;

    const rewindTo = cursor.lastProcessedBlock - 1n;

    await this.prisma.$transaction([
      this.prisma.blockchainEvent.deleteMany({
        where: {
          chainId: cursor.chainId,
          contractAddress: cursor.contractAddress,
          blockNumber: { gte: Number(cursor.lastProcessedBlock) },
        },
      }),
      this.prisma.chainSyncCursor.update({
        where: {
          chainId_contractAddress: {
            chainId: cursor.chainId,
            contractAddress: cursor.contractAddress,
          },
        },
        data: { lastProcessedBlock: rewindTo, lastProcessedBlockHash: null },
      }),
    ]);

    this.logger.warn(
      `reorg detected at block ${cursor.lastProcessedBlock}; rewound to ${rewindTo}`,
    );
    return true;
  }

  /** Returns zero rows for a log this service does not understand. */
  private toRow(
    log: Log,
    chainId: number,
    contractAddress: `0x${string}`,
  ): Prisma.BlockchainEventCreateManyInput[] {
    if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) {
      return [];
    }

    let decoded: { eventName: string; args: unknown };
    try {
      decoded = decodeEventLog({ abi: REGISTRY_ABI, data: log.data, topics: log.topics });
    } catch {
      return [];
    }

    const eventType = EVENT_TYPES[decoded.eventName];
    if (eventType === undefined) return [];

    const args = decoded.args as unknown as Record<string, unknown>;
    const actor = this.actorOf(eventType, args);
    if (actor === null) return [];

    return [
      {
        chainId,
        contractAddress,
        txHash: log.transactionHash,
        logIndex: Number(log.logIndex),
        blockNumber: Number(log.blockNumber),
        blockHash: log.blockHash ?? '',
        eventType,
        commitment: String(args.commitment ?? ''),
        entityId: typeof args.entityId === 'string' ? args.entityId : null,
        financingRef: typeof args.financingRef === 'string' ? args.financingRef : null,
        actor,
        generation: typeof args.generation === 'number' ? args.generation : null,
        payload: toJson(args),
      },
    ];
  }

  private actorOf(eventType: BlockchainEventType, args: Record<string, unknown>): string | null {
    switch (eventType) {
      case BlockchainEventType.INVOICE_RESERVED:
        return typeof args.registrar === 'string' ? args.registrar : null;
      case BlockchainEventType.FINANCING_DECLARED:
        return typeof args.financier === 'string' ? args.financier : null;
      case BlockchainEventType.RESERVATION_CANCELLED:
        return typeof args.cancelledBy === 'string' ? args.cancelledBy : null;
      case BlockchainEventType.CLAIM_CLOSED:
        return typeof args.closedBy === 'string' ? args.closedBy : null;
    }
  }
}

/**
 * JSON-safe copy of decoded event arguments.
 *
 * Event arguments include `uint64` timestamps, which viem returns as `bigint`;
 * `JSON.stringify` throws on those, so they are converted to decimal strings
 * before the value reaches a JSONB column.
 */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  ) as Prisma.InputJsonValue;
}
