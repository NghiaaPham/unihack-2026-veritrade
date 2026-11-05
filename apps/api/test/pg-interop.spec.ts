import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DatabaseService } from '../src/database/database.service.js';

const UNREACHABLE_DB = 'postgresql://user:pass@127.0.0.1:1/unreachable';

const DIST_DIR = new URL('../dist/', import.meta.url);
const BUILT_SERVICE = new URL('database/database.service.js', DIST_DIR);
const BUILT_MAIN = new URL('main.js', DIST_DIR);

/**
 * `pg` is CommonJS but ships an ESM wrapper (`esm/index.mjs`) reachable through
 * `exports.import`. `apps/api` is `"type": "module"`, so `import { Pool } from
 * 'pg'` resolves through that wrapper. If the wrapper disappears, an export is
 * renamed, or the specifier is pointed at the CommonJS entry instead, the named
 * import fails when Node links the module.
 *
 * That failure is invisible to Vitest: Vite's transform pipeline resolves
 * CommonJS named exports that Node's own loader cannot. So the real check runs
 * the built artifact in a child Node process. `pnpm test` builds first
 * (`turbo.json` wires `test` to `build`) so `dist/` matches `src/`.
 */
describe('pg ESM interop', () => {
  it('wires DatabaseService to a real pg Pool', async () => {
    const service = new DatabaseService(new ConfigService({ DATABASE_URL: UNREACHABLE_DB }));

    // $client is the pool handed to drizzle; it must be the same class the
    // service imported, not an interop stand-in. It exists on the value that
    // drizzle() returns but not on the declared NodePgDatabase type.
    const client = (service.db as unknown as { $client: unknown }).$client;
    expect(client).toBeInstanceOf(Pool);

    await service.onApplicationShutdown();
  });

  it('links the built service under Node’s ESM loader', () => {
    expect(existsSync(BUILT_SERVICE), 'dist/ is missing — run pnpm build').toBe(true);

    const script = `await import(${JSON.stringify(BUILT_SERVICE.href)});`;
    const { status, stderr } = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
    });

    expect(stderr.trim(), 'Node failed to link the built module').toBe('');
    expect(status).toBe(0);
  });

  it('emits ESM rather than CommonJS', () => {
    const source = readFileSync(BUILT_MAIN, 'utf8');

    expect(source).toMatch(/^import /m);
    expect(source).not.toMatch(/\brequire\(/);
  });
});
