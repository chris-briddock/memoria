import { beforeEach, describe, expect, it, vi } from "vitest";

// Cookie jar stand-in. next/headers `cookies()` returns an async store; we
// model just the get/set/delete surface the module uses.
const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => jar.get(name),
    set: (name: string, value: string, options?: Record<string, unknown>) =>
      jar.set(name, { value, options }),
    delete: (name: string) => jar.delete(name),
  })),
}));

// The DB-backed invite helpers are not under test here.
vi.mock("@/db", () => ({ db: {} }));

import {
  clearOAuthInviteCookie,
  readOAuthInviteCookie,
  setOAuthInviteCookie,
} from "@/lib/oauth";

const COOKIE = "memoria_oauth_invite";

beforeEach(() => {
  jar.clear();
  process.env.AUTH_SECRET = "unit-test-secret";
});

describe("OAuth invite cookie", () => {
  it("round-trips a code through set and read", async () => {
    await setOAuthInviteCookie("ABCD-1234-EFGH");
    expect(await readOAuthInviteCookie()).toBe("ABCD-1234-EFGH");
  });

  it("sets httpOnly, sameSite=lax and a 10-minute max age", async () => {
    await setOAuthInviteCookie("CODE");
    const stored = jar.get(COOKIE);
    expect(stored?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
  });

  it("rejects a tampered code (signature mismatch)", async () => {
    await setOAuthInviteCookie("REAL-CODE");
    const stored = jar.get(COOKIE)!;
    jar.set(COOKIE, {
      value: stored.value.replace("REAL-CODE", "FAKE-CODE"),
    });
    expect(await readOAuthInviteCookie()).toBeNull();
  });

  it("rejects a cookie signed with a different secret", async () => {
    await setOAuthInviteCookie("CODE");
    process.env.AUTH_SECRET = "another-secret";
    expect(await readOAuthInviteCookie()).toBeNull();
  });

  it("rejects malformed values (no signature, empty)", async () => {
    jar.set(COOKIE, { value: "no-dot-here" });
    expect(await readOAuthInviteCookie()).toBeNull();
    jar.set(COOKIE, { value: ".sig" });
    expect(await readOAuthInviteCookie()).toBeNull();
  });

  it("returns null when the cookie is absent", async () => {
    expect(await readOAuthInviteCookie()).toBeNull();
  });

  it("clears the cookie", async () => {
    await setOAuthInviteCookie("CODE");
    await clearOAuthInviteCookie();
    expect(await readOAuthInviteCookie()).toBeNull();
  });

  it("throws without AUTH_SECRET", async () => {
    delete process.env.AUTH_SECRET;
    await expect(setOAuthInviteCookie("CODE")).rejects.toThrow(/AUTH_SECRET/);
  });
});
