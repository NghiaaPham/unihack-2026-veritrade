import { Injectable } from '@nestjs/common';
import type { Hex } from 'viem';

import { PrismaService } from '../database/prisma.service.js';
import { AvalancheRpcService } from './avalanche-rpc.service.js';

/**
 * Hands out nonces that no other instance can hand out at the same time.
 *
 * The problem this solves is specific. Reading `eth_getTransactionCount` and
 * adding one looks correct and is not: two requests that read the same pending
 * count both sign with the same nonce, and the node accepts both, so one
 * silently replaces the other in the mempool. The lost transaction never
 * reverts — it simply never happens — while the API reports a hash it will
 * never see mined. A process-local mutex cannot help, because the second
 * request is in a different process.
 *
 * So the counter lives in a row and the allocation runs inside a transaction
 * that takes `SELECT ... FOR UPDATE` on it. Two allocators queue on that lock;
 * each sees the other's write. The row is keyed by `(chainId, address)` rather
 * than being global, because two chains or two signers have independent nonce
 * spaces and sharing one counter would produce gaps that stall an account.
 *
 * The node's `pending` count is still consulted, and the allocation is
 * `max(pending, stored)`. `stored` covers the transactions we have reserved but
 * not yet broadcast (invisible to the node); `pending` covers transactions the
 * node knows about but we never recorded — a database restored from an older
 * backup, for instance. Taking the maximum is what makes both cases safe.
 */
@Injectable()
export class NonceAllocatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: AvalancheRpcService,
  ) {}

  /**
   * Reserves the next nonce for `account`.
   *
   * The RPC read happens before the transaction opens: holding a row lock
   * across a network call would serialise every writer behind the slowest RPC
   * response, and a hung request would block allocation for everyone.
   */
  async allocate(account: Hex): Promise<number> {
    const chainId = this.rpc.chainId;
    const address = account.toLowerCase();

    const pending = await this.rpc.publicClient().getTransactionCount({
      address: account,
      blockTag: 'pending',
    });

    return this.prisma.$transaction(async (tx) => {
      // Create-if-absent, then lock. The insert is a no-op on every call after
      // the first, and doing it inside the transaction means the row exists by
      // the time the lock is attempted.
      await tx.$executeRaw`
        INSERT INTO blockchain_signer_nonces (chain_id, address, next_nonce, updated_at)
        VALUES (${chainId}, ${address}, 0, now())
        ON CONFLICT (chain_id, address) DO NOTHING
      `;

      const rows = await tx.$queryRaw<{ next_nonce: number }[]>`
        SELECT next_nonce FROM blockchain_signer_nonces
        WHERE chain_id = ${chainId} AND address = ${address}
        FOR UPDATE
      `;

      const stored = rows[0]?.next_nonce ?? 0;
      const allocated = Math.max(pending, stored);

      await tx.$executeRaw`
        UPDATE blockchain_signer_nonces
        SET next_nonce = ${allocated + 1}, updated_at = now()
        WHERE chain_id = ${chainId} AND address = ${address}
      `;

      return allocated;
    });
  }

  /**
   * How many nonces this signer has handed out beyond what the chain shows.
   *
   * A non-zero value is not an error: it is the number of reserved-but-unmined
   * transactions, and it is the size of the gap that would stall the account if
   * those transactions never landed. Exposed for the health surface and tests.
   */
  async reservedGap(account: Hex): Promise<number> {
    const chainId = this.rpc.chainId;
    const address = account.toLowerCase();

    const rows = await this.prisma.$queryRaw<{ next_nonce: number }[]>`
      SELECT next_nonce FROM blockchain_signer_nonces
      WHERE chain_id = ${chainId} AND address = ${address}
    `;

    if (rows.length === 0) return 0;

    const mined = await this.rpc.publicClient().getTransactionCount({
      address: account,
      blockTag: 'latest',
    });

    return Math.max(0, (rows[0]?.next_nonce ?? 0) - mined);
  }
}
