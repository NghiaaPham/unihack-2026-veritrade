import { Controller, HttpCode, HttpStatus, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { FinancingClaimResponse } from '../blockchain/blockchain.presenter.js';
import { FinancingClaimService } from '../blockchain/financing-claim.service.js';
import { applyOperationStatus } from '../blockchain/operation-status.js';

/** Roles that may move a financing claim. VIEWER is read-only by definition. */
const WRITE_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;

const ERROR_RESPONSES = {
  unauthorized: { status: 401, description: 'Missing, invalid or revoked access token' },
  notFound: {
    status: 404,
    description: "No financing request with this id in the caller's organization",
  },
  conflict: { status: 409, description: 'INVALID_FINANCING_STATE or a failed chain operation' },
} as const;

/**
 * Financing lifecycle endpoints.
 *
 * Each handler enqueues a chain operation and drives it as far as one request
 * can. The response always describes the operation, so a client that receives
 * 202 knows exactly what to poll.
 *
 * Authorization is the same tenant context as everywhere else: the request id
 * is looked up *with* the organization id, so a caller cannot act on another
 * tenant's financing request by guessing a UUID.
 */
@ApiTags('financing-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('v1/financing-requests')
export class FinancingRequestsController {
  constructor(private readonly claims: FinancingClaimService) {}

  @Post(':id/reserve')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Financing request id (UUID)' })
  @ApiOperation({
    summary: 'Reserve the invoice claim for this financing request',
    description:
      'Ensures the invoice is registered on chain and moves the request to RESERVED once the ' +
      'registration is confirmed. Reserving is the same on-chain action as anchoring, so a ' +
      'previously anchored invoice produces no new transaction.',
  })
  @ApiResponse({ status: 200, description: 'Reserved and confirmed' })
  @ApiResponse({ status: 202, description: 'Accepted; transaction pending or outcome unknown' })
  @ApiResponse({ status: 401, description: ERROR_RESPONSES.unauthorized.description })
  @ApiResponse({ status: 404, description: ERROR_RESPONSES.notFound.description })
  @ApiResponse({ status: 409, description: ERROR_RESPONSES.conflict.description })
  async reserve(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FinancingClaimResponse> {
    const result = await this.claims.reserve(auth, id);
    applyOperationStatus(response, result.operation.status);
    return result;
  }

  @Post(':id/declare-financed')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Financing request id (UUID)' })
  @ApiOperation({
    summary: 'Declare that financing was agreed',
    description:
      'Records the financier attestation on chain. This is not a disbursement: the contract ' +
      'cannot see bank transfers and neither can this API, so the request moves to ' +
      'FINANCING_DECLARED rather than FUNDED.',
  })
  @ApiResponse({ status: 200, description: 'Declared and confirmed' })
  @ApiResponse({ status: 202, description: 'Accepted; transaction pending or outcome unknown' })
  @ApiResponse({ status: 401, description: ERROR_RESPONSES.unauthorized.description })
  @ApiResponse({ status: 404, description: ERROR_RESPONSES.notFound.description })
  @ApiResponse({ status: 409, description: ERROR_RESPONSES.conflict.description })
  async declareFinanced(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FinancingClaimResponse> {
    const result = await this.claims.declareFinanced(auth, id);
    applyOperationStatus(response, result.operation.status);
    return result;
  }

  @Post(':id/close')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Financing request id (UUID)' })
  @ApiOperation({
    summary: 'Close a financed claim',
    description: 'Only valid from FINANCING_DECLARED. A closed claim is terminal on chain.',
  })
  @ApiResponse({ status: 200, description: 'Closed and confirmed' })
  @ApiResponse({ status: 202, description: 'Accepted; transaction pending or outcome unknown' })
  @ApiResponse({ status: 401, description: ERROR_RESPONSES.unauthorized.description })
  @ApiResponse({ status: 404, description: ERROR_RESPONSES.notFound.description })
  @ApiResponse({ status: 409, description: ERROR_RESPONSES.conflict.description })
  async close(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FinancingClaimResponse> {
    const result = await this.claims.close(auth, id);
    applyOperationStatus(response, result.operation.status);
    return result;
  }

  @Post(':id/cancel-reservation')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Financing request id (UUID)' })
  @ApiOperation({
    summary: 'Release a reservation that was never financed',
    description:
      'Only valid from RESERVED. A financed claim must be closed instead, which is what the ' +
      'contract enforces as well.',
  })
  @ApiResponse({ status: 200, description: 'Released and confirmed' })
  @ApiResponse({ status: 202, description: 'Accepted; transaction pending or outcome unknown' })
  @ApiResponse({ status: 401, description: ERROR_RESPONSES.unauthorized.description })
  @ApiResponse({ status: 404, description: ERROR_RESPONSES.notFound.description })
  @ApiResponse({ status: 409, description: ERROR_RESPONSES.conflict.description })
  async cancelReservation(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FinancingClaimResponse> {
    const result = await this.claims.cancelReservation(auth, id);
    applyOperationStatus(response, result.operation.status);
    return result;
  }
}
