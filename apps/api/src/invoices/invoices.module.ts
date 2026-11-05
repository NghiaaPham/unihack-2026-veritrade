import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { BlockchainModule } from '../blockchain/blockchain.module.js';
import { InvoiceVerificationModule } from '../invoice-verification/invoice-verification.module.js';
import { DocumentStorageModule } from './storage/document-storage.module.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoiceFingerprintService } from './invoice-fingerprint.service.js';
import { InvoicesService } from './invoices.service.js';
import { InvoiceXmlModule } from './xml/invoice-xml.module.js';

const DEFAULT_MAX_UPLOAD_BYTES = 2_097_152;

/**
 * Invoice intake and retrieval.
 *
 * `MulterModule` is configured from the environment so the byte ceiling is one
 * setting, not two: multer stops reading the stream at the limit (which is what
 * protects the process), and the parser enforces the same number for callers
 * that do not come through HTTP.
 *
 * The default multer storage is memory, which is what this API wants: the
 * document is parsed and content-addressed before anything touches disk, and a
 * temporary file on the way in would be one more copy of a document containing
 * tax identifiers.
 */
@Module({
  imports: [
    AuthModule,
    BlockchainModule,
    AuditLogsModule,
    InvoiceXmlModule,
    DocumentStorageModule,
    InvoiceVerificationModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        limits: {
          fileSize: config.get<number>('INVOICE_MAX_UPLOAD_BYTES') ?? DEFAULT_MAX_UPLOAD_BYTES,
          files: 1,
          fields: 8,
        },
      }),
    }),
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceFingerprintService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
