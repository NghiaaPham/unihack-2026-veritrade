import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { BlockchainTransactionService } from './blockchain-transaction.service.js';
import { presentOperation, type BlockchainOperationResponse } from './blockchain.presenter.js';

/**
 * Chain-facing read endpoints.
 *
 * There is deliberately no endpoint that signs an arbitrary transaction or
 * accepts a destination address: a caller can only ever observe operations the
 * backend itself created for their organization.
 */
@ApiTags('blockchain')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('v1/blockchain')
export class BlockchainController {
  constructor(private readonly transactions: BlockchainTransactionService) {}

  @Get('transactions/:id')
  @ApiParam({ name: 'id', description: 'Blockchain operation id (UUID)' })
  @ApiOperation({
    summary: 'Retrieve one registry transaction',
    description:
      'Returns the operation, its decoded error if it failed, and the raw receipt once mined. ' +
      'A SUBMITTED operation is polled once on read, so the response can be more advanced than the previous one.',
  })
  @ApiResponse({ status: 200, description: 'The operation' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or revoked access token' })
  @ApiResponse({ status: 404, description: 'No such operation in the caller organization' })
  async get(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<BlockchainOperationResponse> {
    const { operation, receipt } = await this.transactions.getForOrganization(
      auth.organizationId,
      id,
    );
    return presentOperation(operation, receipt);
  }
}
