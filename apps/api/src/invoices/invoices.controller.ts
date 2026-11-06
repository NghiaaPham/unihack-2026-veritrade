import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type {
  AnchorStatusResponse,
  BlockchainOperationResponse,
} from '../blockchain/blockchain.presenter.js';
import { presentOperation } from '../blockchain/blockchain.presenter.js';
import { BlockchainQuotaGuard } from '../blockchain/blockchain-quota.guard.js';
import { InvoiceAnchorService } from '../blockchain/invoice-anchor.service.js';
import { applyOperationStatus } from '../blockchain/operation-status.js';
import { CreateInvoiceDto, UploadInvoiceDto } from './dto/create-invoice.dto.js';
import { ListInvoicesQueryDto } from './dto/list-invoices.dto.js';
import type {
  InvoiceDetailResponse,
  InvoiceHistoryResponse,
  InvoiceListResponse,
} from './invoice.presenter.js';
import { InvoicesService, type UploadedInvoiceFile } from './invoices.service.js';
import type { VerificationResponse } from '../invoice-verification/verification.presenter.js';

/** Roles that may create or re-verify. VIEWER is read-only by definition. */
const WRITE_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;

const ERROR_RESPONSES = {
  unauthorized: { status: 401, description: 'Missing, invalid or revoked access token' },
  notFound: { status: 404, description: "No invoice with this id in the caller's organization" },
} as const;

/**
 * Invoice endpoints.
 *
 * Authorization is real, not simulated: `JwtAuthGuard` verifies a signed token
 * and then re-reads the membership row on every request, so the tenant id used
 * for every query comes from the database rather than from the request body or
 * a header. There is no code path that accepts an organization id from a
 * client.
 *
 * Handlers do three things — read the arguments, call the service, return the
 * result. Every decision about parsing, identity, duplication and verification
 * lives below this layer.
 */
@ApiTags('invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('v1/invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly anchors: InvoiceAnchorService,
  ) {}

  @Post()
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an invoice from structured metadata',
    description:
      'The invoice is fingerprinted and verified like an uploaded one, but the checks that ' +
      'need a source document report SKIPPED or NOT_CHECKED rather than passing.',
  })
  @ApiResponse({ status: 201, description: 'Invoice created' })
  @ApiResponse({ status: 400, description: 'The request is not a valid invoice' })
  @ApiResponse({ status: 401, description: ERROR_RESPONSES.unauthorized.description })
  @ApiResponse({ status: 403, description: 'The membership role may not create invoices' })
  @ApiResponse({ status: 409, description: 'DUPLICATE_INVOICE or CONFLICTING_INVOICE' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateInvoiceDto,
  ): Promise<InvoiceDetailResponse> {
    return this.invoices.create(auth, dto);
  }

  @Post('upload')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'e-invoice XML document' },
        dueDate: { type: 'string', example: '2026-12-01' },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload an e-invoice XML document',
    description:
      'Supported formats are listed in docs/invoice-processing.md. The document is parsed with ' +
      'external entities, DTDs and external resource resolution disabled, and only a narrow ' +
      'business view of it is persisted.',
  })
  @ApiResponse({ status: 201, description: 'Invoice created from the document' })
  @ApiResponse({ status: 400, description: 'No file was supplied' })
  @ApiResponse({ status: 401, description: ERROR_RESPONSES.unauthorized.description })
  @ApiResponse({ status: 409, description: 'DUPLICATE_INVOICE or CONFLICTING_INVOICE' })
  @ApiResponse({ status: 413, description: 'DOCUMENT_TOO_LARGE' })
  @ApiResponse({
    status: 422,
    description: 'INVALID_INVOICE_DOCUMENT or UNSUPPORTED_INVOICE_FORMAT',
  })
  upload(
    @CurrentAuth() auth: AuthContext,
    @UploadedFile() file: UploadedInvoiceFile | undefined,
    @Body() dto: UploadInvoiceDto,
  ): Promise<InvoiceDetailResponse> {
    return this.invoices.upload(auth, file, dto);
  }

  @Get()
  @ApiOperation({ summary: "List invoices in the caller's organization" })
  @ApiResponse({ status: 200, description: 'A page of invoices' })
  @ApiResponse({ status: 401, description: ERROR_RESPONSES.unauthorized.description })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListInvoicesQueryDto,
  ): Promise<InvoiceListResponse> {
    return this.invoices.list(auth.organizationId, query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', description: 'Invoice id (UUID)' })
  @ApiOperation({ summary: 'Retrieve one invoice with its latest verification' })
  @ApiResponse({ status: 200, description: 'The invoice' })
  @ApiResponse({ status: 401, description: ERROR_RESPONSES.unauthorized.description })
  @ApiResponse({ status: 404, description: ERROR_RESPONSES.notFound.description })
  get(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<InvoiceDetailResponse> {
    return this.invoices.getById(auth.organizationId, id);
  }

  @Get(':id/verification')
  @ApiParam({ name: 'id', description: 'Invoice id (UUID)' })
  @ApiOperation({
    summary: 'Latest verification result',
    description:
      'Every response carries `scope: LOCAL_CHECKS_ONLY`. A PASSED verdict means every ' +
      'implemented check ran and passed; it is not a statement that the tax authority approved ' +
      'the invoice.',
  })
  @ApiResponse({ status: 200, description: 'The latest run, or null when none has completed' })
  @ApiResponse({ status: 404, description: ERROR_RESPONSES.notFound.description })
  getVerification(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<VerificationResponse | null> {
    return this.invoices.getVerification(auth.organizationId, id);
  }

  @Get(':id/history')
  @ApiParam({ name: 'id', description: 'Invoice id (UUID)' })
  @ApiOperation({ summary: 'Processing history: every verification run and audit event' })
  @ApiResponse({ status: 200, description: 'Newest first' })
  @ApiResponse({ status: 404, description: ERROR_RESPONSES.notFound.description })
  getHistory(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<InvoiceHistoryResponse> {
    return this.invoices.getHistory(auth.organizationId, id);
  }

  @Post(':id/anchor')
  @Roles(...WRITE_ROLES)
  @UseGuards(BlockchainQuotaGuard)
  @ApiParam({ name: 'id', description: 'Invoice id (UUID)' })
  @ApiOperation({
    summary: 'Anchor the invoice in the on-chain registry',
    description:
      'Registers a commitment to the invoice identity on Avalanche Fuji. Anchoring is also the ' +
      'reservation: the contract has one registration call and it moves the commitment to ' +
      'RESERVED. The call is idempotent — repeating it returns the existing operation and sends ' +
      'no second transaction. Responds 202 while the transaction is in flight, 200 once ' +
      'confirmed, 409 if it failed.',
  })
  @ApiResponse({ status: 200, description: 'Confirmed on chain' })
  @ApiResponse({ status: 202, description: 'Accepted; transaction pending or outcome unknown' })
  @ApiResponse({ status: 409, description: 'INVOICE_NOT_VERIFIED or BLOCKCHAIN_OPERATION_FAILED' })
  @ApiResponse({
    status: 429,
    description: 'BLOCKCHAIN_RATE_LIMITED or BLOCKCHAIN_PENDING_LIMIT_REACHED; see Retry-After',
  })
  @ApiResponse({
    status: 503,
    description: 'BLOCKCHAIN_NOT_CONFIGURED or BLOCKCHAIN_SIGNER_NOT_CONFIGURED',
  })
  async anchor(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BlockchainOperationResponse> {
    const { operation, receipt } = await this.anchors.anchor(auth, id);
    applyOperationStatus(response, operation.status);
    return presentOperation(operation, receipt);
  }

  @Get(':id/anchor-status')
  @ApiParam({ name: 'id', description: 'Invoice id (UUID)' })
  @ApiOperation({
    summary: 'Anchor status for an invoice',
    description:
      'Reports whether a confirmed registration exists, the live claim state read from the ' +
      'contract, and the latest operation. `claimStatus` is null when the chain is unreachable — ' +
      'unknown is reported as unknown rather than guessed.',
  })
  @ApiResponse({ status: 200, description: 'Anchor status (operation may be null)' })
  @ApiResponse({ status: 404, description: ERROR_RESPONSES.notFound.description })
  getAnchorStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<AnchorStatusResponse> {
    return this.anchors.status(auth, id);
  }

  @Post(':id/verify')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Invoice id (UUID)' })
  @ApiOperation({
    summary: 'Re-run verification',
    description:
      'Appends a new run to the history. Earlier runs are never overwritten: the record of what ' +
      'was believed at a point in time is the evidence.',
  })
  @ApiResponse({ status: 200, description: 'The new verification result' })
  @ApiResponse({ status: 404, description: ERROR_RESPONSES.notFound.description })
  @ApiResponse({ status: 500, description: 'DOCUMENT_UNAVAILABLE when the stored file is missing' })
  verify(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<VerificationResponse> {
    return this.invoices.reverify(auth.organizationId, auth.userId, id);
  }
}
