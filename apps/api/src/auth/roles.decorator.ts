import { SetMetadata } from '@nestjs/common';
import type { MembershipRole } from '../generated/prisma/client.js';

export const ROLES_KEY = 'auth:required-roles';

/**
 * Declares which membership roles may call a handler.
 *
 * Absent metadata means "any authenticated member", which is the right default
 * for read endpoints. Write endpoints state their roles explicitly rather than
 * inheriting a permissive default.
 */
export const Roles = (...roles: MembershipRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
