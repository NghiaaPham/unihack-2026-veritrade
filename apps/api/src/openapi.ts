import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Where the docs are mounted, under the global `/api` prefix. */
const DOCS_PATH = 'api/docs';

/**
 * OpenAPI document.
 *
 * Disabled in production by the caller. The schema is generated from the
 * decorators, so it cannot drift from the handlers — but it also means an
 * undocumented handler is invisible here, which is why every controller method
 * carries `@ApiOperation`.
 *
 * The description states the two limits that a reader of the schema would
 * otherwise have to discover from the docs directory: verification is local
 * only, and the tax-authority check is not implemented.
 */
export function configureOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('VeriTrade API')
    .setDescription(
      [
        'Invoice intake and verification for the VeriTrade trade-finance platform.',
        '',
        '**Verification scope.** Every result carries `scope: LOCAL_CHECKS_ONLY`. The engine',
        'checks XML structure, required fields, arithmetic, duplicates and XMLDSig. Signature',
        'trust chains and tax-authority approval are reported as NOT_CHECKED or UNSUPPORTED —',
        'they are not performed. A PASSED verdict is not a legal determination.',
        '',
        '**Authentication.** Send `Authorization: Bearer <token>` from `POST /api/v1/auth/login`.',
        'Every invoice endpoint is tenant-scoped to the organization in the token; there is no',
        'request parameter that can override it.',
        '',
        '**Blockchain registry.** Anchoring writes a versioned commitment to the invoice identity',
        'to the VeriTradeInvoiceRegistry contract on Avalanche Fuji. The invoice itself — parties,',
        'tax ids, amounts, documents — never reaches the chain. Anchoring is idempotent: repeating',
        'the call returns the existing operation instead of sending a second transaction.',
        '`FINANCED` on chain means a financier declared financing; it is not evidence that funds',
        'moved, and the API maps it to `FINANCING_DECLARED` rather than `FUNDED`.',
      ].join('\n'),
    )
    .setVersion('0.4.0')
    .addBearerAuth()
    .addTag('auth', 'Registration and token exchange')
    .addTag('invoices', 'Invoice intake, retrieval, verification and anchoring')
    .addTag('financing-requests', 'On-chain financing lifecycle')
    .addTag('blockchain', 'Registry transaction lookup')
    .addTag('health', 'Liveness and readiness')
    .build();

  SwaggerModule.setup(DOCS_PATH, app, SwaggerModule.createDocument(app, config), {
    swaggerOptions: { persistAuthorization: true },
  });
}
