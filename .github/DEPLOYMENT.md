# Deployment — Vercel + Neon + Backblaze B2

Memoria is a Next.js 16 app with three external dependencies in production:

| Concern        | Local (dev/e2e)        | Production            |
| -------------- | ---------------------- | --------------------- |
| App hosting    | `next dev`             | **Vercel**            |
| Postgres       | docker-compose         | **Neon**              |
| Object storage | RustFS (S3-compatible) | **Backblaze B2** (S3) |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit/integration tests,
the full Playwright e2e suite, and a production build on every push/PR. Deploys
are handled by Vercel's Git integration — pushing to `main` triggers a
production deploy, and every PR gets a preview deploy. No separate deploy job is
needed in Actions.

## 1. Neon (Postgres)

1. Create a project at <https://neon.tech>. Note the region — pick one close to
   your Vercel region to minimise query latency.
2. Copy the **pooled connection string** (it includes `-pooler` in the host).
   Neon's pooled endpoint is required for serverless: Vercel functions open many
   short-lived connections, and the pooler (PgBouncer) multiplexes them.
3. Apply the schema. From the repo, with the Neon URL exported:

   ```bash
   cd memoria
   DATABASE_URL="<neon-pooled-url>" npx drizzle-kit push
   ```

   (Or generate SQL with `npm run db:generate` and apply `drizzle/` migrations.)

## 2. Backblaze B2 (object storage)

1. Create a **private** bucket (e.g. `memoria-photos`) at
   <https://www.backblaze.com/b2>.
2. Create an **Application Key** scoped to that bucket with read/write.
3. Note the bucket's **S3 endpoint**, shown in the bucket details — it looks
   like `https://s3.us-west-004.backblazeb2.com`. The region is the middle
   segment (`us-west-004`).

The app talks S3 via `@aws-sdk/client-s3`, so B2's S3-compatible API works as-is.

## 3. Vercel (app hosting)

1. Import the repo into Vercel. Set the **Root Directory** to `memoria`.
2. Framework preset: **Next.js** (auto-detected). Build command `next build`,
   install `npm ci` — both default.
3. Add the environment variables below (**Production** and **Preview**).
4. Deploy. The first registered account becomes the admin (see
   `MEMORIA_BOOTSTRAP_EMAIL` below).

> The Vercel build needs the same env vars present at build time, because
> `/register` prerenders and queries the user count. Neon is reachable during
> the build, so this works without extra config.

### Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**:

| Variable                | Value                                             |
| ----------------------- | ------------------------------------------------- |
| `DATABASE_URL`          | Neon pooled connection string                     |
| `AUTH_SECRET`           | `openssl rand -hex 32`                            |
| `AUTH_URL`              | `https://<your-domain>` (production URL)          |
| `AUTH_TRUST_HOST`       | `true`                                            |
| `S3_ENDPOINT`           | `https://s3.<region>.backblazeb2.com`             |
| `S3_REGION`             | B2 region, e.g. `us-west-004`                     |
| `S3_BUCKET`             | `memoria-photos`                                  |
| `S3_ACCESS_KEY_ID`      | B2 application key ID                             |
| `S3_SECRET_ACCESS_KEY`  | B2 application key                                |
| `MEMORIA_BOOTSTRAP_EMAIL` | Optional: always treat this email as admin on first register |
| `AUTH_GOOGLE_ID`        | Optional: Google OAuth client ID (see below)     |
| `AUTH_GOOGLE_SECRET`    | Optional: Google OAuth client secret             |

These mirror the names in [`memoria/.env.e2e`](../memoria/.env.e2e) and
[`memoria/.env.example`](../memoria/.env.example); keep real values out of git.

## 3a. OAuth sign-in (optional)

Sign-in works password-only out of the box. Setting a provider's env pair adds
"Continue with …" buttons to `/signin` and `/register`, and a link/unlink
control under **Family → Sign-in methods**. A provider with missing
credentials is simply never offered.

### Google

1. **Google Cloud Console → APIs & Services → Credentials → Create Credentials
   → OAuth client ID** (type: Web application).
2. Add an **Authorized redirect URI**:
   - Production: `https://<your-domain>/api/auth/callback/google`
   - Preview/dev: `http://localhost:3000/api/auth/callback/google`
3. Copy the **Client ID** and **Client Secret** into `AUTH_GOOGLE_ID` /
   `AUTH_GOOGLE_SECRET`.

The OAuth consent screen needs only the default `openid email profile`
scopes — no sensitive-scope verification is required.

### How OAuth accounts behave

- **Joining:** a new user must enter an invite code on `/register` and click
  "Continue with Google". The code rides the OAuth round-trip in a signed
  httpOnly cookie, and the account is created and linked in one step.
  Password is optional on that path.
- **Linking:** a signed-in user clicks **Link** under Family → Sign-in
  methods; Auth.js attaches the provider to the existing account.
- **Unlinking:** removing the *last* sign-in method requires a password to be
  set first, so nobody locks themselves out.

## 4. Wiring it together

- **CI** (GitHub Actions) is self-contained: it spins up throwaway Postgres and
  RustFS service containers and never touches Neon/B2/Vercel. No secrets needed.
- **CD** (Vercel) is automatic on push once the env vars above are set. To add
  preview-deploy protection or run e2e against previews, that would be a
  separate workflow — out of scope here.
