import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // esbuild cannot emit `design:paramtypes`, which Nest's DI depends on, so
    // TypeScript is compiled through SWC with decorator metadata enabled.
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 30_000,
    // Every suite truncates all 18 tables between cases. Against PGlite that
    // was harmless, because one WASM engine serialised everything anyway.
    // Against a real server it is a deadlock: two files take AccessExclusive
    // locks on the same tables in different orders and Postgres aborts one
    // with 40P01. The suites share a database, so they cannot run at the same
    // time — serialise only when the database is real, and keep PGlite fast.
    fileParallelism: process.env.TEST_DATABASE_URL === undefined,
  },
});
