import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/database/prisma.service.js';

const UNREACHABLE_DB = 'postgresql://user:pass@127.0.0.1:1/unreachable';

const DIST_DIR = new URL('../dist/', import.meta.url);
const BUILT_SERVICE = new URL('database/prisma.service.js', DIST_DIR);
const BUILT_APP_MODULE = new URL('app.module.js', DIST_DIR);
const BUILT_MAIN = new URL('main.js', DIST_DIR);

/**
 * Guards the ESM/CJS boundary of the built API.
 *
 * `pg` is CommonJS but ships an ESM wrapper (`esm/index.mjs`) reachable through
 * `exports.import`. `apps/api` is `"type": "module"`, so `import { Pool } from
 * 'pg'` resolves through that wrapper. If the wrapper disappears, an export is
 * renamed, or the specifier is pointed at the CommonJS entry, the named import
 * fails when Node links the module.
 *
 * That failure is invisible to Vitest: Vite's transform pipeline resolves
 * CommonJS named exports that Node's own loader cannot. So the real check runs
 * the built artifact in a child Node process. `pnpm test` builds first
 * (`turbo.json` wires `test` to `build`) so `dist/` matches `src/`.
 *
 * Prisma's generated client adds a second hazard: it imports its own files
 * with explicit `.ts` specifiers, which only work after TypeScript rewrites
 * them to `.js`. A regression there also only shows up under Node's loader.
 */
describe('ESM interop of the built API', () => {
  it('constructs without dialling the database', async () => {
    // The pool connects lazily on purpose: the API must boot while Postgres is
    // down, so the failure belongs to the query that needed it, not to startup.
    //
    // Note the absence of `toBeInstanceOf(PrismaService)`: PrismaClient is a
    // Proxy, and `instanceof` against a subclass recurses through the trap
    // until the stack overflows. Prisma documents the same caveat — `instanceof`
    // is unreliable once more than one client copy is loaded.
    const service = new PrismaService(new ConfigService({ DATABASE_URL: UNREACHABLE_DB }));

    expect(typeof service.$queryRaw).toBe('function');
    expect(typeof service.trade.findMany).toBe('function');

    await service.onApplicationShutdown();
  });

  it('links the built service under Node’s ESM loader', () => {
    expect(existsSync(BUILT_SERVICE), 'dist/ is missing — run pnpm build').toBe(true);

    const script = `
      const { PrismaService } = await import(${JSON.stringify(BUILT_SERVICE.href)});
      const pg = await import('pg');
      if (typeof PrismaService !== 'function') {
        throw new Error('PrismaService is not exported from the built service');
      }
      if (typeof pg.Pool !== 'function') {
        throw new Error('pg no longer exposes a named Pool export under ESM');
      }
    `;

    const { status, stderr } = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
    });

    expect(stderr.trim(), 'Node failed to link the built module').toBe('');
    expect(status).toBe(0);
  });

  it('links the whole built module graph', () => {
    expect(existsSync(BUILT_APP_MODULE), 'dist/ is missing — run pnpm build').toBe(true);

    // Importing the module graph resolves every controller, service and
    // generated Prisma model without starting a server or opening a socket.
    const script = `await import(${JSON.stringify(BUILT_APP_MODULE.href)});`;

    const { status, stderr } = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: UNREACHABLE_DB },
      timeout: 20_000,
    });

    expect(stderr.trim(), 'Node failed to link the built application').toBe('');
    expect(status).toBe(0);
  });

  it('emits ESM rather than CommonJS', () => {
    const source = readFileSync(BUILT_MAIN, 'utf8');

    expect(source).toMatch(/^import /m);
    expect(source).not.toMatch(/\brequire\(/);
  });
});
