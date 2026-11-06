import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';

import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import { AppException } from '../common/errors/app.exception.js';
import { BlockchainQuotaService } from './blockchain-quota.service.js';

/**
 * Charges a chain write against the tenant's quota before the handler runs.
 *
 * Placed after `JwtAuthGuard` so `request.auth` is already resolved: the quota
 * is keyed by the organization from the verified token, never by anything the
 * caller supplied. A request that arrives without a context falls through —
 * `JwtAuthGuard` has already rejected it with 401, and returning 429 instead
 * would tell an unauthenticated caller that the endpoint exists.
 *
 * The `Retry-After` header is set here rather than in the exception filter
 * because the filter does not know which window the request was refused in.
 */
@Injectable()
export class BlockchainQuotaGuard implements CanActivate {
  constructor(private readonly quota: BlockchainQuotaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request.auth;

    if (auth === undefined) return true;

    const decision = await this.quota.consume(auth);

    if (decision.allowed) return true;

    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', String(decision.retryAfterSeconds));

    throw new AppException(
      HttpStatus.TOO_MANY_REQUESTS,
      decision.code,
      decision.message,
      decision.details,
    );
  }
}
