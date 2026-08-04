// Runs before any test module is imported. Point Drizzle at the disposable
// `memoria_test` database (created via docker compose / global-setup) and drop
// any pg Pool the dev server cached on globalThis, so the Pool is built with
// this connection string rather than whatever .env.local says.
process.env.DATABASE_URL =
  "postgres://memoria:memoria_dev_password@localhost:5432/memoria_test";
delete (globalThis as { pool?: unknown }).pool;
