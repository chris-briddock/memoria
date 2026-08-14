import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

// Next.js dev server hot-reloads modules, which would otherwise leak a new
// pool on every reload. Reuse one pool per process.
const globalForDb = globalThis as unknown as {
  pool?: Pool;
  db?: Db;
};

function getPool(): Pool {
  if (globalForDb.pool) return globalForDb.pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({ connectionString, max: 10 });
  if (process.env.NODE_ENV !== "production") {
    globalForDb.pool = pool;
  }
  return pool;
}

/**
 * Resolve the real Drizzle client, creating the pool on first use.
 *
 * Unlike the {@link db} proxy this returns a genuine `PgDatabase` instance.
 * The Auth.js Drizzle adapter detects the database flavour by walking the
 * instance's prototype chain for Drizzle's entity-kind brand
 * (`drizzle-orm/entity` `is()`), which a Proxy over `{}` cannot satisfy — so
 * anything that needs the real instance (the adapter) must call this.
 */
export function getDb(): Db {
  globalForDb.db ??= drizzle(getPool(), { schema });
  return globalForDb.db;
}

/**
 * Lazily initialized Drizzle client.
 *
 * Importing this module must not require `DATABASE_URL`, because Next.js
 * imports route modules during `next build` page-data collection. Any actual
 * property access still requires the env var at runtime.
 *
 * Do NOT pass this proxy to `DrizzleAdapter` — use {@link getDb} there so the
 * adapter receives a real `PgDatabase` (see `getDb` for why).
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    globalForDb.db ??= drizzle(getPool(), { schema });
    return Reflect.get(globalForDb.db, prop, receiver);
  },
  has(_target, prop) {
    globalForDb.db ??= drizzle(getPool(), { schema });
    return prop in globalForDb.db;
  },
  ownKeys() {
    globalForDb.db ??= drizzle(getPool(), { schema });
    return Reflect.ownKeys(globalForDb.db);
  },
  getOwnPropertyDescriptor(_target, prop) {
    const instance = globalForDb.db;
    if (!instance) {
      // Re-entrant access while getDb() is still initializing (e.g. Auth.js's
      // createUser gate). Returning a non-enumerable placeholder keeps the
      // proxy invariants satisfied without crashing the object descriptors
      // of whatever triggered us.
      return { value: undefined, writable: true, enumerable: false, configurable: true };
    }
    return Object.getOwnPropertyDescriptor(instance, prop);
  },
});

export { schema };
