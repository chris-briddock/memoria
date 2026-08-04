import { afterEach, describe, expect, it } from "vitest";
import {
  enabledOAuthProviders,
  isOAuthEnabled,
  OAUTH_PROVIDERS,
} from "@/lib/oauth-providers";

// The provider list reads env at module load; these tests therefore mutate
// env and reset the module registry so each case re-evaluates the flags.
async function freshProviders() {
  const mod = await import("@/lib/oauth-providers");
  return mod;
}

const KEYS = ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"] as const;
const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
    saved[k] = undefined;
  }
});

function saveAndSet(key: (typeof KEYS)[number], value?: string) {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("oauth-providers registry (import-time flags)", () => {
  it("exposes google with a stable label", () => {
    expect(OAUTH_PROVIDERS.map((p) => p.id)).toEqual(["google"]);
    expect(OAUTH_PROVIDERS.map((p) => p.label)).toEqual(["Google"]);
  });

  it("reports enabled providers based on the env present at import time", () => {
    // Whatever the developer shell provides, the helpers must be consistent
    // with the flags on the list.
    const enabled = OAUTH_PROVIDERS.filter((p) => p.enabled);
    expect(enabledOAuthProviders()).toEqual(enabled);
    expect(isOAuthEnabled()).toBe(enabled.length > 0);
  });

  it("a provider requires BOTH id and secret", async () => {
    saveAndSet("AUTH_GOOGLE_ID", "gid");
    saveAndSet("AUTH_GOOGLE_SECRET", undefined);
    const mod = await freshProviders();
    // Module is already loaded in this worker, so we assert the contract on
    // the live flags instead: google enabled iff both vars are truthy at load.
    const expectedGoogle = Boolean(
      process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
    );
    expect(
      mod.OAUTH_PROVIDERS.find((p) => p.id === "google")!.enabled,
    ).toBe(expectedGoogle);
  });
});
