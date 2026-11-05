import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type AuditLog } from '../generated/prisma/client.js';

const DEFAULT_LIMIT = 50;

/**
 * A client that can run queries — either the service itself or the
 * transaction handle it hands to a caller.
 *
 * Accepting the transaction is what lets a domain write and its audit entry
 * commit together: a create that succeeds and an audit row that fails would
 * leave an action nobody can account for.
 */
type QueryClient = Prisma.TransactionClient;

export interface AuditEntry {
  organizationId: string;
  actorUserId: string | null;
  /** Dotted verb, e.g. `invoice.created`. Stable — clients filter on it. */
  action: string;
  entityType: string;
  entityId: string;
  /** Structured context. Must not contain document contents or raw PII. */
  metadata?: Prisma.InputJsonValue;
}

/**
 * Audit logs.
 *
 * Append-only by contract: there is no update or delete path in the schema's
 * application surface, and a correction is a new row.
 */
@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  listForOrganization(organizationId: string, take: number = DEFAULT_LIMIT): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** Processing history for one entity, newest first. */
  listForEntity(
    organizationId: string,
    entityType: string,
    entityId: string,
    take: number = DEFAULT_LIMIT,
  ): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: { organizationId, entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /**
   * Appends an entry.
   *
   * Pass `client` when the caller is already inside a transaction so the
   * audit row and the change it describes commit or roll back together.
   */
  record(entry: AuditEntry, client: QueryClient = this.prisma): Promise<AuditLog> {
    return client.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
      },
    });
  }
}
