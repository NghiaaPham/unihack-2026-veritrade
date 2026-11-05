import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MembershipRole } from '../generated/prisma/client.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';
import { ROLES_KEY } from './roles.decorator.js';

/**
 * Enforces `@Roles(...)`.
 *
 * Must run after `JwtAuthGuard`, which is what populates `request.auth`.
 * Reading the role from the request rather than from the token matters: the
 * token's `role` claim is a snapshot from issue time, and a demoted user must
 * lose the ability to write immediately.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<MembershipRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required === undefined || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (request.auth === undefined) {
      // Reaching here means the route declared roles but not JwtAuthGuard.
      // Failing closed is the only safe interpretation.
      throw new UnauthorizedException('Authentication is required');
    }

    if (!required.includes(request.auth.role)) {
      throw new ForbiddenException(
        `This action requires one of the following roles: ${required.join(', ')}`,
      );
    }

    return true;
  }
}
