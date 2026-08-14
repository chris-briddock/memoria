import { describe, it, expect, vi } from "vitest";

// src/auth.ts imports NextAuth, which touches the request context on import.
// Mock it (and the DB) so we can inspect the plain `adapter` export without a
// server or a database connection. We only need the adapter's shape.
const adapterSymbol = Symbol("captured-adapter");

vi.mock("next-auth", () => ({
  default: (config: Record<string, unknown>) => {
    // Stash the raw adapter for assertions.
    (globalThis as Record<symbol, unknown>)[adapterSymbol] = config.adapter;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
  AuthError: class AuthError extends Error {},
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: (config: unknown) => ({ id: "credentials", config }),
}));
vi.mock("next-auth/providers/google", () => ({
  default: (config: unknown) => ({ id: "google", config }),
}));

vi.mock("@auth/drizzle-adapter", () => ({
  DrizzleAdapter: vi.fn(() => {
    throw new Error(
      "DrizzleAdapter must not be constructed at import time — it requires DATABASE_URL",
    );
  }),
}));

vi.mock("@/db", () => ({
  db: {},
  getDb: vi.fn(),
}));

vi.mock("@/db/schema", () => ({
  users: {},
  accounts: {},
  sessions: {},
  verificationTokens: {},
}));

vi.mock("@/lib/oauth", () => ({
  claimInvite: vi.fn(),
  clearOAuthInviteCookie: vi.fn(),
  findRedeemableInvite: vi.fn(),
  readOAuthInviteCookie: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// The adapter Auth.js's init() consumes is the one it enumerates with
// Object.keys(). The previous Proxy-over-{} implementation enumerated to
// nothing, so init() rebuilt an empty adapter and the OAuth callback died with
// "getUserByAccount is not a function". Pin the contract: every method the
// Drizzle adapter exposes must be an own, enumerable key.
describe("auth adapter shape", () => {
  it("exposes every adapter method via Object.keys() for Auth.js init()", async () => {
    await import("@/auth");
    const adapter = (globalThis as Record<symbol, Record<string, unknown>>)[
      adapterSymbol
    ];

    const expected = [
      "createUser",
      "getUser",
      "getUserByEmail",
      "getUserByAccount",
      "updateUser",
      "deleteUser",
      "linkAccount",
      "unlinkAccount",
      "getSessionAndUser",
      "createSession",
      "updateSession",
      "deleteSession",
      "createVerificationToken",
      "useVerificationToken",
      "getAccount",
    ];

    for (const name of expected) {
      expect(
        Object.keys(adapter),
        `adapter must expose ${name} to Object.keys()`,
      ).toContain(name);
      expect(
        typeof adapter[name],
        `adapter.${name} must be a function`,
      ).toBe("function");
    }
  });
});
