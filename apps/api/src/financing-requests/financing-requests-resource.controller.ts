import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CreateFinancingRequestDto } from './dto/create-financing-request.dto.js';
import { ListFinancingRequestsQueryDto } from './dto/list-financing-requests.dto.js';
import type {
  FinancingRequestListResponse,
  FinancingRequestResponse,
} from './financing-request.presenter.js';
import { FinancingRequestsService } from './financing-requests.service.js';

/** Roles that may open a request. VIEWER is read-only by definition. */
const WRITE_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;

const ERROR_RESPONSES = {
  unauthorized: { status: 401, description: 'Missing, invalid or revoked access token' },
  notFound: {
    status: 404,
    description: "No financing request with this id in the caller's organization",
  },
} as const;

/**
 * Financing request read and create routes.
 *
 * Deliberately a separate controller from the chain lifecycle one: that
 * controller meters every route with `BlockchainQuotaGuard`, and this one never
 * sends a transaction, so it must not spend the organisation's chain quota.
 * The tenant comes from the verified token, never from a parameter.
 */
@ApiTags('financing-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('v1/financing-requests')
export class FinancingRequestsResourceController {
  constructor(private readonly requests: FinancingRequestsService) {}

  @Get()
  @ApiOperation({
    summary: 'List financing requests of the caller organization',
    description: 'Newest first. Filter by status or invoice; paginate with limit and offset.',
  })
  @ApiResponse({ status: 200, description: 'A page of financing requests' })
  @ApiResponse({ status: 400, description: 'Invalid filter or pagination parameter' })
  @ApiResponse({ status: 401, description: ERROR_RESPONSES.unauthorized.description })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListFinancingRequestsQueryDto,
  ): Promise<FinancingRequestListResponse> {
    return this.requests.list(auth.organizationId, query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', description: 'Financing request id (UUID)' })
  @ApiOperation({ summary: 'Get one financing request with its invoice summary' })
  @ApiResponse({ status: 200, description: 'The financing request' })
  @ApiResponse({ status: 401, description: ERROR_RESPONSES.unauthorized.description })
  @ApiResponse({ status: 404, description: ERROR_RESPONSES.notFound.description })
  getById(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<FinancingRequestResponse> {
    return this.requests.getById(auth.organizationId, id);
  }

  @Post()
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Open a financing request for a verified invoice',
    description:
      'Creates a REQUESTED request. The invoice must belong to the caller organization and ' +
      'its latest verification must be PASSED or PARTIAL. Only one request per invoice may be ' +
      'active. No chain transaction is sent; use POST /:id/reserve for that. The invoice ' +
      'status is not changed.',
  })
  @ApiResponse({ status: 201, description: 'Request created' })
  @ApiResponse({
    status: 400,
    description: 'Validation error, or REQUESTED_AMOUNT_EXCEEDS_INVOICE',
  })
  @ApiResponse({ status: 401, description: ERROR_RESPONSES.unauthorized.description })
  @ApiResponse({ status: 403, description: 'The caller role is read-only (VIEWER)' })
  @ApiResponse({ status: 404, description: "INVOICE_NOT_FOUND in the caller's organization" })
  @ApiResponse({
    status: 409,
    description: 'INVOICE_NOT_VERIFIED or FINANCING_REQUEST_ACTIVE',
  })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateFinancingRequestDto,
  ): Promise<FinancingRequestResponse> {
    return this.requests.create(auth, dto);
  }
}
