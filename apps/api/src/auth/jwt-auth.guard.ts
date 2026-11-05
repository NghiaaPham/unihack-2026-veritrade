import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import type { AuthContext, JwtPayload } from './auth.types.js';

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

/**
 * Verifies the bearer token and resolves the tenant context.
 *
 * Two things happen here, and both are necessary:
 *   1. The token signature and expiry are checked, which proves the caller is
 *      the user the token was issued to.
 *   2. The membership row is re-read from the database, which proves that user
 *      is *still* a member of the organisation the token names.
 *
 * Skipping step 2 is the common mistake: it makes a token a permanent grant,
 * so removing someone from an organisation would not actually remove their
 * access until the token expired.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);

    if (token === null) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: JwtPayload;

    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      // Expired, tampered with, wrong secret, or not a JWT at all. The reason
      // is deliberately not echoed: it helps an attacker and not a client.
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (typeof payload.sub !== 'string' || typeof payload.org !== 'string') {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const auth = await this.authService.resolveContext(payload.sub, payload.org);

    if (auth === null) {
      throw new UnauthorizedException('Access token is no longer valid');
    }

    request.auth = auth;

    return true;
  }

  private extractToken(request: AuthenticatedRequest): string | null {
    const header = request.headers.authorization;

    if (typeof header !== 'string') {
      return null;
    }

    const [scheme, ...rest] = header.split(' ');

    if (scheme?.toLowerCase() !== 'bearer') {
      return null;
    }

    const token = rest.join(' ').trim();

    return token.length === 0 ? null : token;
  }
}
