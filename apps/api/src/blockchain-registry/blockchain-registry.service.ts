import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { BlockchainRecord } from '../generated/prisma/client.js';

/**
 * Blockchain registry: the bridge between off-chain rows and on-chain anchors.
 *
 * Only pointers and hashes are stored here — never the underlying document or
 * any personal data. Submitting transactions and indexing confirmations are
 * Phase 3.
 */
@Injectable()
export class BlockchainRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A transaction hash is unique per chain, not globally, which is why the
   * composite key is used instead of `txHash` alone.
   */
  findByTxHash(chainId: number, txHash: string): Promise<BlockchainRecord | null> {
    return this.prisma.blockchainRecord.findUnique({
      where: { chainId_txHash: { chainId, txHash } },
    });
  }
}
