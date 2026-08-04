# Memoria

A private, self-hosted photo vault for one family. Photos live on your own
hardware — nothing is sent to a third-party service.

- **Next.js 16** (App Router, React 19, Tailwind v4)
- **Postgres** via Drizzle ORM
- **Backblaze B2** for object storage (any S3-compatible backend works)
- **Auth.js v5** with invite-only email + password accounts

## Getting started

```bash
cp .env.example .env.local          # then set AUTH_SECRET and your B2 keys
npm install
npm run db:up                       # Postgres (and RustFS, if you want it)
npm run db:migrate                  # create the schema
npm run dev
```

Generate an `AUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Open http://localhost:3000. The **first account you create becomes the family
admin** — no invite code needed. After that, signup is closed: an admin mints
invite codes under **Family**, and each code can be claimed exactly once.

### Storage

Photos go to **Backblaze B2** (10 GB free). In the B2 console create a bucket,
then an application key scoped to it, and copy the endpoint plus both key
halves into `.env.local` — `.env.example` spells out which field is which.
Bucket names on B2 are unique across every Backblaze account, so pick something
distinctive; the app will tell you if the name is taken.

Any S3-compatible backend works. A **RustFS** container is included in
`docker-compose.yml` for offline development — point `S3_*` at
`http://localhost:9000` and the same code path serves it.

| Service                   | URL                   |
| ------------------------- | --------------------- |
| App                       | http://localhost:3000 |
| Postgres                  | `localhost:5432`      |
| RustFS console (optional) | http://localhost:9001 |

## How it works

**Uploads** go to `POST /api/upload` as multipart form data. For each file the
server hashes the bytes (sha256), skips it if that hash already exists, reads
the EXIF capture date, generates a 640px WebP thumbnail with sharp, writes both
objects to the bucket, and records a row in Postgres. Files are processed one at
a time so peak memory stays bounded to a single image.

**Object keys** are content-addressed and sharded:
`ab/<full-sha256>/orig.jpg` and `ab/<full-sha256>/thumb.webp`.

**Serving.** The bucket is private. Image bytes are streamed back through
`GET /api/photos/[id]/[variant]` behind a session check, so there are no public
or presigned URLs pointing at family photos.

There is no server-side cache: each thumbnail is fetched from B2 the first time
a given browser asks for it, then held by that browser for a year via
`Cache-Control: private, max-age=31536000, immutable`. Object keys are
content-addressed, so a stale cache entry is never wrong. The trade-off is that
a first visit to a large gallery pays one B2 round trip per thumbnail — B2
allows 2,500 free Class B calls a day, and charges $0.004 per 10,000 after
that. If that first load ever feels slow, caching thumbnails on local disk is
the fix.

**Authorization** lives in `src/lib/dal.ts` (`verifySession`), called by every
page, server action and route handler that touches data. `src/proxy.ts` only
does an optimistic cookie check to bounce signed-out visitors — per the Next.js
docs it is _not_ a security boundary, just a redirect shortcut.

**Sorting.** The gallery groups by EXIF capture date, so scans and old camera
exports file themselves under the year they were taken rather than the day they
were uploaded.

## Layout

```
src/
  app/
    (vault)/        signed-in pages: gallery, albums, photo detail, family
    signin/         sign in
    register/       bootstrap + invite redemption
    api/
      auth/         Auth.js handlers
      upload/       multipart ingest
      photos/       authenticated image streaming
  components/       nav, photo grid, uploader
  db/               Drizzle schema + client
  lib/
    dal.ts          session verification (the authorization boundary)
    queries.ts      reads
    actions/        server actions (writes)
    ingest.ts       hashing, dedupe, EXIF, thumbnails
    storage.ts      RustFS / S3 client
  proxy.ts          optimistic redirect (Next.js 16 renamed middleware to proxy)
```

## Testing

Unit and integration tests use **Vitest** and run against a disposable
`memoria_test` Postgres database — never your dev data. The S3 boundary is
mocked, so no RustFS/B2 is needed.

```bash
npm run db:up        # Postgres must be running first
npm test             # run the suite once
npm run coverage     # run with the v8 coverage report + 90% gate
```

`npm run coverage` enforces ≥ 90% lines/branches/functions/statements over
`src/lib/**` and `src/components/photo-grid.tsx`. Presentational JSX (the
`PhotoGrid` markup) and the S3 client functions in `storage.ts` are excluded
from measurement — the plan defers those to Playwright e2e and mocks the S3
boundary respectively. Real `sharp`/`exifr` run against committed fixture
images under `test/fixtures/` to cover orientation, EXIF, and thumbnailing.

## Scripts

| Command               | Purpose                          |
| --------------------- | -------------------------------- |
| `npm run dev`         | Dev server                       |
| `npm run build`       | Production build                 |
| `npm run typecheck`   | `tsc --noEmit`                   |
| `npm run lint`        | ESLint                           |
| `npm test`            | Run the Vitest suite             |
| `npm run test:watch`  | Vitest in watch mode             |
| `npm run coverage`    | Vitest + v8 coverage (90% gate)  |
| `npm run db:up`       | Start Postgres + RustFS          |
| `npm run db:down`     | Stop them                        |
| `npm run db:generate` | Generate a migration from schema |
| `npm run db:migrate`  | Apply migrations                 |
| `npm run db:studio`   | Drizzle Studio                   |

## Before exposing this beyond your LAN

The credentials in `docker-compose.yml` and `.env.example` are development
defaults and are well known. At minimum:

- set a fresh `AUTH_SECRET` and Postgres password
- scope the B2 application key to the one bucket, not the whole account
- serve over HTTPS (Auth.js then issues `__Secure-` cookies)
- set `AUTH_URL` to the real origin
- keep ports 5432/9000/9001 off the public internet
- clear `MEMORIA_BOOTSTRAP_EMAIL` once your admin account exists — it grants
  admin to anyone who registers with that address, not just the first person
