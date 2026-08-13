/**
 * Cloud photo-import providers. These are distinct from sign-in OAuth
 * providers (`src/lib/oauth-providers.ts`): a storage connection creates its
 * own `accounts` row (provider = "gdrive" | "onedrive"), so importing never
 * implicates the sign-in identity and scopes can differ freely.
 *
 * `google-photos` is a *surface*, not a connection: it reuses the "gdrive"
 * account but talks to the Google Photos Picker API instead of the Drive
 * file-listing API. Entering the picker requires `next` navigation to
 * Google-hosted UI; the import flow polls the resulting Picker session.
 */
export type CloudProviderId = "gdrive" | "onedrive";
export type ImportSurfaceId = CloudProviderId | "google-photos";

export type CloudProviderDef = {
  id: CloudProviderId;
  label: string;
  shortLabel: string;
  /** Full OAuth scope string to request. */
  scope: string;
  /** Env vars required before offering connect. */
  env: { id: string; secret: string };
  authorizeUrl: string;
  tokenUrl: string;
  /** 'form' = application/x-www-form-urlencoded; providers differ. */
  tokenContentType: "json" | "form";
  /** Extra body fields merged into token exchange/refresh. */
  tokenExtraBody?: Record<string, string>;
  /** Extra query params on the authorize request. */
  authorizeExtraParams?: Record<string, string>;
};

export const CLOUD_PROVIDERS: CloudProviderDef[] = [
  {
    id: "gdrive",
    label: "Google Drive",
    shortLabel: "Google",
    scope: "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/photospicker.mediaitems.readonly",
    env: { id: "IMPORT_GOOGLE_CLIENT_ID", secret: "IMPORT_GOOGLE_CLIENT_SECRET" },
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    tokenContentType: "form",
    // `access_type=offline` is required for Google to issue a refresh token at
    // all; `prompt=consent` forces re-consent so reconnecting yields one even
    // if the user previously granted without offline access.
    authorizeExtraParams: { access_type: "offline", prompt: "consent" },
  },
  {
    id: "onedrive",
    label: "Microsoft OneDrive",
    shortLabel: "Microsoft",
    // `offline_access` requests the refresh token; `Files.Read` is the least
    // privileged scope covering both listing and downloading.
    scope: "Files.Read offline_access",
    env: { id: "IMPORT_MICROSOFT_CLIENT_ID", secret: "IMPORT_MICROSOFT_CLIENT_SECRET" },
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    tokenContentType: "form",
  },
];

export function cloudProvider(id: string): CloudProviderDef | undefined {
  return CLOUD_PROVIDERS.find((p) => p.id === id);
}

export function isCloudProviderEnabled(def: CloudProviderDef): boolean {
  return Boolean(process.env[def.env.id] && process.env[def.env.secret]);
}

export function enabledCloudProviders() {
  return CLOUD_PROVIDERS.filter(isCloudProviderEnabled);
}

/** Provider id + client credentials, or null when not configured. */
export function cloudProviderCredentials(def: CloudProviderDef) {
  const clientId = process.env[def.env.id];
  const clientSecret = process.env[def.env.secret];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export type ImportSurface = {
  id: ImportSurfaceId;
  label: string;
  /* Surfaced in the UI as the button hint when disabled. */
  reason?: string;
  provider: CloudProviderDef;
  /** Where the surface's file listing comes from. */
  kind: "drive" | "picker";
};

export const IMPORT_SURFACES: ImportSurface[] = [
  { id: "gdrive", label: "Google Drive", provider: CLOUD_PROVIDERS[0], kind: "drive" },
  { id: "onedrive", label: "Microsoft OneDrive", provider: CLOUD_PROVIDERS[1], kind: "drive" },
  // Google Photos shares the gdrive OAuth account but needs the separate Picker UI.
  { id: "google-photos", label: "Google Photos", provider: CLOUD_PROVIDERS[0], kind: "picker" },
];

export function importSurface(id: string): ImportSurface | undefined {
  return IMPORT_SURFACES.find((s) => s.id === id);
}
