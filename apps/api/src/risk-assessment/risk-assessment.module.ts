import { Module } from '@nestjs/common';
import { RiskAssessmentService } from './risk-assessment.service.js';

@Module({
  providers: [RiskAssessmentService],
  exports: [RiskAssessmentService],
})
export class RiskAssessmentModule {}
