import { Module } from '@nestjs/common';
import { InvoiceXmlParserService } from './invoice-xml-parser.service.js';

/**
 * The parser on its own, with no dependency on the invoice service.
 *
 * It lives in a separate module because two consumers need it and neither owns
 * the other: `InvoicesModule` parses on upload, and
 * `InvoiceVerificationModule` parses again to verify what was stored. Folding
 * it into either one would force the other into a circular import.
 */
@Module({
  providers: [InvoiceXmlParserService],
  exports: [InvoiceXmlParserService],
})
export class InvoiceXmlModule {}
