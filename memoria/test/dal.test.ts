import { beforeEach, describe, expect, it, vi } from "vitest";

// dal resolves identity from `auth()` and redirects via next/navigation. Both
// are mocked; no database is involved.
const { auth, redirect } = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/navigation", () => ({ redirect }));

// React `cache` memoizes per render; under test each call shares one cache, so
// reset modules between cases to get a fresh memoized function.
let dal: typeof import("@/lib/dal");

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  dal = await import("@/lib/dal");
});

const SESSION = {
  user: {
    id: "u1",
    email: "ada@example.com",
    name: "Ada",
    role: "admin" as const,
  },
};

describe("verifySession", () => {
  it("maps the session to a SessionUser", async () => {
    auth.mockResolvedValue(SESSION);
    const user = await dal.verifySession();
    expect(user).toEqual({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      role: "admin",
    });
  });

  it("redirects to /signin when there is no session", async () => {
    auth.mockResolvedValue(null);
    // redirect throws in real Next; here it returns undefined, so verifySession
    // would continue — assert the redirect was invoked.
    redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT /signin");
    });
    await expect(dal.verifySession()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/signin");
  });

  it("defaults missing email/name/role", async () => {
    auth.mockResolvedValue({ user: { id: "u2" } });
    const user = await dal.verifySession();
    expect(user).toEqual({ id: "u2", email: "", name: null, role: "member" });
  });
});

describe("getSessionUser", () => {
  it("returns null instead of redirecting when signed out", async () => {
    auth.mockResolvedValue(null);
    expect(await dal.getSessionUser()).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("returns the user when signed in", async () => {
    auth.mockResolvedValue(SESSION);
    expect(await dal.getSessionUser()).toMatchObject({ id: "u1" });
  });

  it("defaults missing email/name/role", async () => {
    auth.mockResolvedValue({ user: { id: "u9" } });
    expect(await dal.getSessionUser()).toEqual({
      id: "u9",
      email: "",
      name: null,
      role: "member",
    });
  });
});

describe("requireAdmin", () => {
  it("returns the user for an admin", async () => {
    auth.mockResolvedValue(SESSION);
    expect(await dal.requireAdmin()).toMatchObject({ role: "admin" });
  });

  it("redirects non-admins to /", async () => {
    auth.mockResolvedValue({ user: { ...SESSION.user, role: "member" } });
    redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT /");
    });
    await expect(dal.requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/");
  });
});
