import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { RiskAssessment } from '../generated/prisma/client.js';

/**
 * Risk assessment.
 *
 * Assessments are a time series, never updated in place: a re-score adds a row
 * so the evidence behind an earlier decision survives. The scoring models
 * themselves are Phase 3.
 */
@Injectable()
export class RiskAssessmentService {
  constructor(private readonly prisma: PrismaService) {}

  latestForRequest(financingRequestId: string): Promise<RiskAssessment | null> {
    return this.prisma.riskAssessment.findFirst({
      where: { financingRequestId },
      orderBy: { assessedAt: 'desc' },
    });
  }
}
