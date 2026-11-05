/**
 * Test environment.
 *
 * `AppModule` validates its environment at boot and refuses to start without a
 * `DATABASE_URL` and a `JWT_SECRET`, which is the behaviour we want in
 * production. The tests never dial that URL — they override `PrismaService`
 * with a client pointed at an in-process PGlite — but the variable still has to
 * be parseable for the validation to pass.
 *
 * `??=` rather than `=`: a developer running the suite against a real local
 * database keeps their value.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://veritrade:veritrade@127.0.0.1:5432/veritrade';

// 32 characters, which is the minimum the validator accepts. It is a test
// secret and is deliberately not shaped like a real one.
process.env.JWT_SECRET ??= 'test-only-jwt-secret-not-for-deployment';
process.env.AUTH_ALLOW_REGISTRATION ??= 'true';

// Under the repository, not /tmp: `LocalDocumentStorage` resolves a relative
// path against the working directory, and `var/` is git-ignored. Documents are
// content-addressed, so the directory holds at most one file per fixture no
// matter how often the suite runs.
process.env.INVOICE_STORAGE_DIR ??= 'var/test-invoices';
