/**
 * The OAuth providers Memoria knows how to sign in with. The sign-in and
 * register screens always offer the buttons; a provider whose credentials
 * are not configured yet fails with a clear inline error from
 * `beginOAuthSignIn` instead of silently disappearing.
 *
 * The `enabled` flag (credentials actually configured) is still tracked so
 * the settings "Sign-in methods" section only offers to link providers that
 * are usable. It keys off the client ID only, not the secret: this module is
 * evaluated inside *server* components and the result passed down to client
 * buttons as props, but keying on the (non-secret) ID means the same check
 * would also work if inlined. The secret is only read in `auth.ts` (server).
 */
export type OAuthProviderId = "google";

export const OAUTH_PROVIDERS: {
  id: OAuthProviderId;
  label: string;
  enabled: boolean;
}[] = [
  { id: "google", label: "Google", enabled: Boolean(process.env.AUTH_GOOGLE_ID) },
];

/** Providers with credentials configured — safe to offer for linking. */
export function enabledOAuthProviders() {
  return OAUTH_PROVIDERS.filter((p) => p.enabled);
}

/** Every known provider, configured or not — for the auth screens. */
export function allOAuthProviders() {
  return OAUTH_PROVIDERS.map(({ id, label }) => ({ id, label }));
}

export function isOAuthEnabled(): boolean {
  return enabledOAuthProviders().length > 0;
}
