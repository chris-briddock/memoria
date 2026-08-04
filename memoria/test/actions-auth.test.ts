import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mocks ----------------------------------------------------------------

// `next-auth` imports `next/server`, which does not resolve under Vitest, and
// we only need `AuthError` for an `instanceof` check. Provide a local stand-in.
const { signIn, signOut, AuthError } = vi.hoisted(() => {
  class AuthError extends Error {
    type: string;
    constructor(type: string) {
      super(type);
      this.type = type;
      this.name = "AuthError";
    }
  }
  return {
    signIn: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    signOut: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    AuthError,
  };
});

vi.mock("next-auth", () => ({ AuthError }));
vi.mock("@/auth", () => ({ signIn, signOut }));

// Chainable Drizzle mock (same pattern as actions-photos.test.ts).
function makeChain(result: unknown) {
  const chain: Record<string, unknown> & { result: unknown } = { result };
  for (const m of ["from", "set", "where", "values", "returning"]) {
    chain[m] = vi.fn(() => chain);
  }
  (chain.values as ReturnType<typeof vi.fn>).mockImplementation((v: unknown) => {
    insertCaptures.push(v);
    return chain;
  });
  (chain.set as ReturnType<typeof vi.fn>).mockImplementation((v: unknown) => {
    setCaptures.push(v);
    return chain;
  });
  chain.then = (
    onFulfilled?: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

let insertCaptures: unknown[] = [];
let setCaptures: unknown[] = [];
// Queue of findFirst results consumed in order.
let findFirstQueue: unknown[] = [];
// Result for the select(count()) chain.
let countResult = 0;
// Result for the update().returning() claim chain.
let claimResult: unknown[] = [];

vi.mock("@/db", () => {
  const db = {
    select: vi.fn(() => {
      const c = makeChain([{ value: countResult }]);
      return c;
    }),
    insert: vi.fn(() => makeChain([{ id: "new-user-id" }])),
    update: vi.fn(() => makeChain(claimResult)),
    delete: vi.fn(() => makeChain(undefined)),
    query: {
      users: { findFirst: vi.fn(() => Promise.resolve(findFirstQueue.shift())) },
      invites: {
        findFirst: vi.fn(() => Promise.resolve(findFirstQueue.shift())),
      },
    },
  };
  return { db };
});

// Signed invite cookie helpers: real signing is covered by oauth-cookie.test;
// here we only verify the action sets the cookie with the submitted code.
const { setOAuthInviteCookie } = vi.hoisted(() => ({
  setOAuthInviteCookie: vi.fn<(code: string) => Promise<void>>(),
}));
vi.mock("@/lib/oauth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/oauth")>();
  return { ...original, setOAuthInviteCookie };
});

// The provider registry reads env at import time. Tests toggle `enabled` on
// the shared OAUTH_PROVIDERS entries directly instead of re-importing modules.
import { OAUTH_PROVIDERS } from "@/lib/oauth-providers";

function setProviderEnabled(enabled: boolean) {
  for (const p of OAUTH_PROVIDERS) p.enabled = enabled;
}

import {
  beginOAuthSignIn,
  registerAction,
  signInAction,
  signOutAction,
} from "@/lib/actions/auth";

// ---- Fixtures -------------------------------------------------------------

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const VALID = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  password: "a-very-long-password",
};

beforeEach(() => {
  vi.clearAllMocks();
  insertCaptures = [];
  setCaptures = [];
  findFirstQueue = [];
  countResult = 0;
  claimResult = [];
  delete process.env.MEMORIA_BOOTSTRAP_EMAIL;
  setProviderEnabled(true);
});

// ---- signInAction ----------------------------------------------------------

describe("signInAction", () => {
  it("lowercases the email and forwards credentials with a safe redirect", async () => {
    signIn.mockResolvedValue(undefined);

    await signInAction(undefined, fd({
      email: "ADA@Example.COM",
      password: "pw",
      next: "/albums",
    }));

    expect(signIn).toHaveBeenCalledWith("credentials", {
      email: "ada@example.com",
      password: "pw",
      redirectTo: "/albums",
    });
  });

  it("forces external/missing redirect targets back to /", async () => {
    signIn.mockResolvedValue(undefined);
    await signInAction(undefined, fd({ email: "a@b.c", password: "pw", next: "https://evil.example" }));
    expect(signIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ redirectTo: "/" }),
    );
  });

  it("returns a friendly error on AuthError", async () => {
    signIn.mockRejectedValue(new AuthError("CredentialsSignin"));
    const result = await signInAction(undefined, fd({ email: "a@b.c", password: "wrong" }));
    expect(result).toEqual({
      error: "That email and password combination isn't right.",
    });
  });

  it("rethrows non-AuthError (e.g. the success redirect)", async () => {
    const redirectSignal = new Error("NEXT_REDIRECT");
    signIn.mockRejectedValue(redirectSignal);
    await expect(
      signInAction(undefined, fd({ email: "a@b.c", password: "pw" })),
    ).rejects.toBe(redirectSignal);
  });
});

// ---- signOutAction ---------------------------------------------------------

describe("signOutAction", () => {
  it("signs out to the sign-in page", async () => {
    signOut.mockResolvedValue(undefined);
    await signOutAction();
    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/signin" });
  });
});

// ---- registerAction: validation -------------------------------------------

describe("registerAction validation", () => {
  it("rejects a short password before touching the db", async () => {
    const result = await registerAction(undefined, fd({ ...VALID, password: "short" }));
    expect(result).toEqual({ error: "Use at least 10 characters" });
  });

  it("rejects an invalid email", async () => {
    const result = await registerAction(undefined, fd({ ...VALID, email: "not-an-email" }));
    expect(result).toEqual({ error: "Enter a valid email address" });
  });

  it("rejects a missing name", async () => {
    const result = await registerAction(undefined, fd({ ...VALID, name: "   " }));
    expect(result).toEqual({ error: "Please enter your name" });
  });
});

// ---- registerAction: bootstrap (first user) -------------------------------

describe("registerAction bootstrap", () => {
  it("creates the first account as admin with no invite code", async () => {
    countResult = 0;
    findFirstQueue = [undefined]; // no existing user
    signIn.mockResolvedValue(undefined);

    await registerAction(undefined, fd(VALID));

    expect(insertCaptures[0]).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@example.com",
      role: "admin",
    });
    expect(signIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ email: "ada@example.com", redirectTo: "/" }),
    );
  });

  it("rejects a duplicate email even during bootstrap", async () => {
    countResult = 0;
    findFirstQueue = [{ id: "existing" }]; // existing user

    const result = await registerAction(undefined, fd(VALID));

    expect(result).toEqual({
      error: "An account with that email already exists.",
    });
    expect(insertCaptures).toHaveLength(0);
  });
});

// ---- registerAction: invite flow ------------------------------------------

describe("registerAction invite flow", () => {
  beforeEach(() => {
    countResult = 3; // not bootstrap
  });

  it("requires an invite code once users exist", async () => {
    findFirstQueue = [undefined]; // no existing user
    const result = await registerAction(undefined, fd(VALID));
    expect(result).toEqual({ error: "An invite code is required." });
  });

  it("rejects an invalid or used invite code", async () => {
    findFirstQueue = [undefined, undefined]; // no existing user, no invite
    const result = await registerAction(undefined, fd({ ...VALID, inviteCode: "BAD-CODE" }));
    expect(result).toEqual({
      error: "That invite code is not valid or has been used.",
    });
  });

  it("creates a member and claims the invite on success", async () => {
    findFirstQueue = [undefined, { id: "invite-1" }]; // no user, valid invite
    claimResult = [{ id: "invite-1" }]; // claim succeeds
    signIn.mockResolvedValue(undefined);

    await registerAction(undefined, fd({ ...VALID, inviteCode: "GOOD-CODE" }));

    expect(insertCaptures[0]).toMatchObject({ role: "member" });
    expect(setCaptures[0]).toMatchObject({ claimedBy: "new-user-id" });
    expect(signIn).toHaveBeenCalled();
  });

  it("rolls back the user when the invite was claimed in a race", async () => {
    findFirstQueue = [undefined, { id: "invite-1" }];
    claimResult = []; // claim returned nothing -> race lost

    const result = await registerAction(undefined, fd({ ...VALID, inviteCode: "GOOD-CODE" }));

    expect(result).toEqual({
      error: "That invite code was just used by someone else.",
    });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("promotes to admin when email matches MEMORIA_BOOTSTRAP_EMAIL", async () => {
    process.env.MEMORIA_BOOTSTRAP_EMAIL = "ada@example.com";
    findFirstQueue = [undefined, { id: "invite-1" }];
    claimResult = [{ id: "invite-1" }];
    signIn.mockResolvedValue(undefined);

    await registerAction(undefined, fd({ ...VALID, inviteCode: "GOOD-CODE" }));

    expect(insertCaptures[0]).toMatchObject({ role: "admin" });
  });
});

// ---- beginOAuthSignIn ------------------------------------------------------

describe("beginOAuthSignIn", () => {
  it("rejects an unknown provider", async () => {
    const result = await beginOAuthSignIn(undefined, fd({ provider: "twitter" }));
    expect(result).toEqual({ error: "Unknown sign-in provider." });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("starts the provider redirect without an invite code", async () => {
    signIn.mockResolvedValue(undefined);
    const result = await beginOAuthSignIn(undefined, fd({ provider: "google" }));
    expect(result).toBeUndefined();
    expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/" });
    expect(setOAuthInviteCookie).not.toHaveBeenCalled();
  });

  it("forces external redirect targets back to /", async () => {
    signIn.mockResolvedValue(undefined);
    await beginOAuthSignIn(
      undefined,
      fd({ provider: "google", next: "https://evil.example" }),
    );
    expect(signIn).toHaveBeenCalledWith(
      "google",
      expect.objectContaining({ redirectTo: "/" }),
    );
  });

  it("sets the signed invite cookie for a valid code before redirecting", async () => {
    findFirstQueue = [{ id: "invite-1" }]; // redeemable invite
    signIn.mockResolvedValue(undefined);

    const result = await beginOAuthSignIn(
      undefined,
      fd({ provider: "google", inviteCode: "GOOD-CODE" }),
    );

    expect(result).toBeUndefined();
    expect(setOAuthInviteCookie).toHaveBeenCalledWith("GOOD-CODE");
    expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/" });
  });

  it("rejects an invalid invite code without starting the OAuth flow", async () => {
    findFirstQueue = [undefined]; // no redeemable invite

    const result = await beginOAuthSignIn(
      undefined,
      fd({ provider: "google", inviteCode: "BAD-CODE" }),
    );

    expect(result).toEqual({
      error: "That invite code is not valid or has been used.",
    });
    expect(setOAuthInviteCookie).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("refuses a provider that is not configured, before any redirect", async () => {
    setProviderEnabled(false);
    const result = await beginOAuthSignIn(undefined, fd({ provider: "google" }));
    expect(result).toEqual({
      error: "Sign-in with Google is not configured on this server yet.",
    });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("returns a friendly error when the provider fails to start", async () => {
    signIn.mockRejectedValue(new AuthError("OAuthSignin"));
    const result = await beginOAuthSignIn(undefined, fd({ provider: "google" }));
    expect(result).toEqual({
      error: "Could not start sign-in with that provider.",
    });
  });

  it("rethrows the success redirect", async () => {
    const redirectSignal = new Error("NEXT_REDIRECT");
    signIn.mockRejectedValue(redirectSignal);
    await expect(
      beginOAuthSignIn(undefined, fd({ provider: "google" })),
    ).rejects.toBe(redirectSignal);
  });
});
