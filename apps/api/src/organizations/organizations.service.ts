import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Organization } from '../generated/prisma/client.js';

/**
 * Organisations: the tenant root.
 *
 * Every other domain module reads or writes rows that belong to one of these.
 * Creation, status transitions and membership administration are Phase 3.
 */
@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id } });
  }
}
