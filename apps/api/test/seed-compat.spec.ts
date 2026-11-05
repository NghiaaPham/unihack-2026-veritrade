import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * `pnpm db:seed` runs `node prisma/seed.ts` — Node's native type stripping, no
 * bundler. That mode erases types but does not transform anything: a decorator,
 * an `enum`, or a constructor parameter property is a syntax error, and a
 * relative `./x.js` specifier cannot resolve because only `.ts` files exist.
 *
 * The seed shares the invoice identity rules with the API rather than copying
 * them, which means those modules have to stay loadable in that mode. This test
 * is the only thing that checks it — `tsc` is happy with decorators and with
 * `.js` specifiers, so the seed broke silently once already.
 */
function loadUnderTypeStripping(relativePath: string): string {
  const url = new URL(relativePath, import.meta.url).href;
  const script = `await import(${JSON.stringify(url)}); process.stdout.write('ok');`;

  return execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('modules imported by prisma/seed.ts', () => {
  it.each(['../src/invoices/invoice-fingerprint.ts', '../src/invoices/invoice-normalization.ts'])(
    'loads %s under Node type stripping',
    (relativePath) => {
      expect(loadUnderTypeStripping(relativePath)).toBe('ok');
    },
  );

  it('computes the same identity as the injectable wrapper', async () => {
    // Loading is necessary but not sufficient: the seed must produce the same
    // hash the API would, or a seeded invoice would never be recognised as a
    // duplicate of a real upload.
    const pure = await import('../src/invoices/invoice-fingerprint.js');
    const { InvoiceFingerprintService } =
      await import('../src/invoices/invoice-fingerprint.service.js');

    const identity = {
      sellerTaxId: '0101234567',
      series: 'C25TAA',
      number: '123',
      templateCode: '1',
    };

    expect(pure.sha256Hex(pure.canonicalIdentity(identity))).toBe(
      new InvoiceFingerprintService().identity(identity),
    );
  });
});
