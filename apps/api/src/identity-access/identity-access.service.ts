import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { User } from '../generated/prisma/client.js';

/**
 * Identity and access.
 *
 * Owns `User`, `OrganizationMembership` and, later, authentication. Only the
 * lookup below exists: session issuance, credential verification and
 * authorisation guards are Phase 3 work.
 */
@Injectable()
export class IdentityAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Email is stored lowercased, so the lookup has to normalise too — otherwise
   * a caller passing `Alice@Example.com` misses a row that exists.
   */
  findUserByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  }
}
