import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthContext } from './auth.types.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

/**
 * Injects the resolved tenant context.
 *
 * Using this instead of reading `request` in a controller keeps the dependency
 * explicit: a handler that needs the tenant says so in its signature, and one
 * that does not need it cannot accidentally read a half-populated request.
 */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request.auth;

    if (auth === undefined) {
      // Unreachable when JwtAuthGuard is applied; the throw documents the
      // invariant rather than letting `undefined` flow into a query.
      throw new Error('CurrentAuth used on a route without JwtAuthGuard');
    }

    return auth;
  },
);
