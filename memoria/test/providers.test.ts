import { afterEach, describe, expect, it } from "vitest";
import {
  CLOUD_PROVIDERS,
  cloudProvider,
  cloudProviderCredentials,
  enabledCloudProviders,
  importSurface,
  isCloudProviderEnabled,
} from "@/lib/import-providers";

describe("cloud provider configuration", () => {
  afterEach(() => {
    delete process.env.IMPORT_GOOGLE_CLIENT_ID;
    delete process.env.IMPORT_GOOGLE_CLIENT_SECRET;
    delete process.env.IMPORT_MICROSOFT_CLIENT_ID;
    delete process.env.IMPORT_MICROSOFT_CLIENT_SECRET;
    delete process.env.AUTH_GOOGLE_ID;
    delete process.env.AUTH_GOOGLE_SECRET;
  });

  it("reports unconfigured providers as disabled without leaking credentials", () => {
    for (const def of CLOUD_PROVIDERS) {
      expect(isCloudProviderEnabled(def)).toBe(false);
      expect(cloudProviderCredentials(def)).toBeNull();
    }
    expect(enabledCloudProviders()).toHaveLength(0);
  });

  it("enables a provider only when both id and secret are set", () => {
    process.env.IMPORT_GOOGLE_CLIENT_ID = "id-only";
    expect(isCloudProviderEnabled(cloudProvider("gdrive")!)).toBe(false);

    process.env.IMPORT_GOOGLE_CLIENT_SECRET = "secret";
    expect(isCloudProviderEnabled(cloudProvider("gdrive")!)).toBe(true);
    expect(cloudProviderCredentials(cloudProvider("gdrive")!)).toEqual({
      clientId: "id-only",
      clientSecret: "secret",
    });
  });

  it("uses the provider's own env prefix so Google sign-in and Drive import don't collide", () => {
    // Sign-in Google (AUTH_GOOGLE_ID) must not accidentally enable Drive
    // imports, which need broader scopes and a separate consent screen.
    process.env.AUTH_GOOGLE_ID = "signin-id";
    process.env.AUTH_GOOGLE_SECRET = "signin-secret";
    expect(isCloudProviderEnabled(cloudProvider("gdrive")!)).toBe(false);
  });

  it("google-photos surface shares the gdrive account", () => {
    const surface = importSurface("google-photos");
    expect(surface?.provider).toBe(cloudProvider("gdrive"));
    expect(surface?.kind).toBe("picker");
  });
});
