import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { DocumentStorageModule } from '../invoices/storage/document-storage.module.js';
import { InvoiceXmlModule } from '../invoices/xml/invoice-xml.module.js';
import { ArithmeticCheck } from './checks/arithmetic.check.js';
import { DuplicateCheck } from './checks/duplicate.check.js';
import { RequiredFieldsCheck } from './checks/required-fields.check.js';
import { SignatureTrustCheck } from './checks/signature-trust.check.js';
import { TaxAuthorityCheck } from './checks/tax-authority.check.js';
import { XmlSignatureCheck } from './checks/xml-signature.check.js';
import { XmlStructureCheck } from './checks/xml-structure.check.js';
import type { VerificationCheck } from './checks/check.types.js';
import { InvoiceVerificationService } from './invoice-verification.service.js';
import { VERIFICATION_CHECKS, VerificationEngineService } from './verification-engine.service.js';

/**
 * The check inventory, in execution order.
 *
 * Order is the order results are reported in, roughly
 * cheapest-and-most-fundamental first: structure, then fields, then
 * arithmetic, then the checks that need cryptography or an external party.
 *
 * Adding a check is a class plus one entry in the list below. Removing one is
 * not free — invoices verified before the removal keep their recorded result,
 * but new runs would silently lose a dimension, so a removal also changes what
 * the verdict means and belongs in docs/invoice-verification.md.
 */
export const VERIFICATION_CHECK_CLASSES = [
  XmlStructureCheck,
  RequiredFieldsCheck,
  ArithmeticCheck,
  DuplicateCheck,
  XmlSignatureCheck,
  SignatureTrustCheck,
  TaxAuthorityCheck,
] as const;

@Module({
  imports: [AuditLogsModule, InvoiceXmlModule, DocumentStorageModule],
  providers: [
    ...VERIFICATION_CHECK_CLASSES,
    {
      // Resolved through DI rather than `new`: `DuplicateCheck` needs the
      // database, and hand-constructing it would hide that dependency.
      provide: VERIFICATION_CHECKS,
      useFactory: (...checks: VerificationCheck[]): VerificationCheck[] => checks,
      inject: [...VERIFICATION_CHECK_CLASSES],
    },
    VerificationEngineService,
    InvoiceVerificationService,
  ],
  exports: [InvoiceVerificationService, VerificationEngineService],
})
export class InvoiceVerificationModule {}
