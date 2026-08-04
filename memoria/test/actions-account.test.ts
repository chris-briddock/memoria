import { beforeEach, describe, expect, it, vi } from "vitest";

// `next-auth` pulls in `next/server`, which does not resolve under Vitest;
// the account actions only need our mock signIn.
const { signIn, revalidatePath } = vi.hoisted(() => ({
  signIn: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/auth", () => ({ signIn }));
vi.mock("next/cache", () => ({ revalidatePath }));

// Session mock: unlink/link require a signed-in user.
let sessionUser: { id: string; email: string; name: string | null; role: "admin" | "member" } | null =
  { id: "user-1", email: "ada@example.com", name: "Ada", role: "member" };
vi.mock("@/lib/dal", () => ({
  verifySession: vi.fn(async () => {
    if (!sessionUser) throw new Error("not signed in");
    return sessionUser;
  }),
}));

// Chainable Drizzle mock (same pattern as actions-auth.test.ts).
let deleteWhereCaptures: unknown[] = [];

function makeChain(result: unknown) {
  const chain: Record<string, unknown> & { result: unknown } = { result };
  for (const m of ["from", "set", "where", "values", "returning"]) {
    chain[m] = vi.fn(() => chain);
  }
  (chain.where as ReturnType<typeof vi.fn>).mockImplementation((v: unknown) => {
    deleteWhereCaptures.push(v);
    return chain;
  });
  chain.then = (
    onFulfilled?: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

// Fixture state driven by each test.
let userRow: { passwordHash: string | null } | undefined;
let linkedAccounts: { provider: string }[] = [];

vi.mock("@/db", () => ({
  db: {
    delete: vi.fn(() => makeChain(undefined)),
    update: vi.fn(() => makeChain(undefined)),
    query: {
      users: {
        findFirst: vi.fn(() => Promise.resolve(userRow)),
      },
      accounts: {
        findMany: vi.fn(() => Promise.resolve(linkedAccounts)),
      },
    },
  },
}));

import {
  changePassword,
  linkOAuthAccount,
  unlinkOAuthAccount,
  updateName,
} from "@/lib/actions/account";

beforeEach(() => {
  vi.clearAllMocks();
  deleteWhereCaptures = [];
  userRow = { passwordHash: "hash" };
  linkedAccounts = [];
  sessionUser = {
    id: "user-1",
    email: "ada@example.com",
    name: "Ada",
    role: "member",
  };
});

describe("linkOAuthAccount", () => {
  it("starts an OAuth redirect back to settings", async () => {
    signIn.mockResolvedValue(undefined);
    await linkOAuthAccount("google");
    expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/settings" });
  });

  it("propagates the redirect thrown by signIn", async () => {
    const redirectSignal = new Error("NEXT_REDIRECT");
    signIn.mockRejectedValue(redirectSignal);
    await expect(linkOAuthAccount("google")).rejects.toBe(redirectSignal);
  });
});

describe("unlinkOAuthAccount", () => {
  it("removes a linked provider when other sign-in methods remain", async () => {
    userRow = { passwordHash: "hash" };
    linkedAccounts = [{ provider: "google" }];

    const result = await unlinkOAuthAccount("google");

    expect(result).toBeUndefined();
    expect(deleteWhereCaptures).toHaveLength(1);
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("allows unlinking one OAuth provider when another remains, even with no password", async () => {
    userRow = { passwordHash: null };
    linkedAccounts = [{ provider: "google" }, { provider: "google-work" }];

    const result = await unlinkOAuthAccount("google");

    expect(result).toBeUndefined();
  });

  it("refuses to remove the last sign-in method without a password set", async () => {
    userRow = { passwordHash: null };
    linkedAccounts = [{ provider: "google" }];

    const result = await unlinkOAuthAccount("google");

    expect(result).toEqual({
      error:
        "Set a password before removing your last sign-in method, or you would lock yourself out.",
    });
    expect(deleteWhereCaptures).toHaveLength(0);
  });

  it("rejects a provider that is not linked", async () => {
    userRow = { passwordHash: "hash" };
    linkedAccounts = [];

    const result = await unlinkOAuthAccount("google");

    expect(result).toEqual({
      error: "That provider is not linked to your account.",
    });
    expect(deleteWhereCaptures).toHaveLength(0);
  });

  it("errors when the user row is missing", async () => {
    userRow = undefined;
    linkedAccounts = [{ provider: "google" }];

    const result = await unlinkOAuthAccount("google");

    expect(result).toEqual({ error: "Account not found." });
  });
});

// ---- updateName ------------------------------------------------------------

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("updateName", () => {
  it("trims and saves a valid name", async () => {
    const result = await updateName(undefined, fd({ name: "  Ada Lovelace  " }));
    expect(result).toEqual({ success: "Name updated." });
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("rejects a blank name", async () => {
    const result = await updateName(undefined, fd({ name: "   " }));
    expect(result).toEqual({ error: "Please enter your name" });
  });

  it("rejects a name over 80 characters", async () => {
    const result = await updateName(undefined, fd({ name: "x".repeat(81) }));
    expect(result?.error).toBeTruthy();
  });
});

// ---- changePassword --------------------------------------------------------

describe("changePassword", () => {
  const GOOD = { newPassword: "a-very-long-password", confirmPassword: "a-very-long-password" };

  it("rejects a short new password", async () => {
    const result = await changePassword(
      undefined,
      fd({ newPassword: "short", confirmPassword: "short" }),
    );
    expect(result).toEqual({ error: "Use at least 10 characters" });
  });

  it("rejects mismatched confirmation", async () => {
    const result = await changePassword(
      undefined,
      fd({ newPassword: GOOD.newPassword, confirmPassword: "different-password" }),
    );
    expect(result).toEqual({ error: "The new passwords do not match." });
  });

  it("sets a password for an OAuth-only account without asking for the current one", async () => {
    userRow = { passwordHash: null };
    const result = await changePassword(undefined, fd(GOOD));
    expect(result).toEqual({ success: "Password set." });
  });

  it("changes the password when the current one is correct", async () => {
    // bcrypt hash of "current-password-123" (cost 4, precomputed for speed).
    const { hashSync } = await import("bcryptjs");
    userRow = { passwordHash: hashSync("current-password-123", 4) };
    const result = await changePassword(
      undefined,
      fd({ ...GOOD, currentPassword: "current-password-123" }),
    );
    expect(result).toEqual({ success: "Password changed." });
  });

  it("rejects a wrong current password", async () => {
    const { hashSync } = await import("bcryptjs");
    userRow = { passwordHash: hashSync("current-password-123", 4) };
    const result = await changePassword(
      undefined,
      fd({ ...GOOD, currentPassword: "wrong-password" }),
    );
    expect(result).toEqual({ error: "Your current password is not correct." });
  });

  it("requires the current password when one is set", async () => {
    const { hashSync } = await import("bcryptjs");
    userRow = { passwordHash: hashSync("current-password-123", 4) };
    const result = await changePassword(undefined, fd(GOOD));
    expect(result).toEqual({ error: "Enter your current password." });
  });

  it("errors when the user row is missing", async () => {
    userRow = undefined;
    const result = await changePassword(undefined, fd(GOOD));
    expect(result).toEqual({ error: "Account not found." });
  });
});
