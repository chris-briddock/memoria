// Runs before any test module is imported.
//
// Point Drizzle at the disposable `memoria_test` database (created via docker
// compose / global-setup) and drop any cached DB state from globalThis, so a
// Pool is built with this connection string rather than whatever local env a
// dev shell happens to have loaded.
//
// Suites that explicitly do not want any DB configuration (for example the
// build-time lazy-init regression test) can override/reset these globals in a
// worker before importing `@/db`.
process.env.DATABASE_URL =
  "postgres://memoria:memoria_dev_password@localhost:5432/memoria_test";

delete (globalThis as { pool?: unknown }).pool;
delete (globalThis as { db?: unknown }).db;
