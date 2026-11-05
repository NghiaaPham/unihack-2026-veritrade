import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { FinancingRequest } from '../generated/prisma/client.js';

/**
 * Financing requests.
 *
 * Owns the `activeKey` invariant that stops one invoice being financed twice
 * while still allowing a rejected request to be retried. Enforcing that
 * invariant on write, and the approval workflow, are Phase 3.
 */
@Injectable()
export class FinancingRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Scoped by tenant on purpose: `organizationId` is the first column of the
   * supporting index, so a caller that forgets it is a visible bug rather than
   * a slow full scan that silently leaks another organisation's rows.
   */
  listForOrganization(organizationId: string): Promise<FinancingRequest[]> {
    return this.prisma.financingRequest.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
