<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Memoria

Self-hosted family photo vault. Next.js 16 + Postgres (Drizzle) + RustFS
(S3-compatible) + Auth.js v5.

## Things that will bite you

- **There is no `middleware.ts`.** Next.js 16 renamed it to `proxy.ts`, which
  lives at `src/proxy.ts` and exports `proxy` plus a `config.matcher`.
- **`proxy.ts` is not a security boundary.** It only checks whether a session
  cookie exists. Every real authorization check goes through `verifySession()`
  in `src/lib/dal.ts`, called close to the data. Server actions are reachable by
  direct POST, so each one must verify independently.
- **Auth.js v5 needs `--legacy-peer-deps`** to install against Next 16; its peer
  range does not list 16 yet.
- **Credentials provider forces `session.strategy: "jwt"`.** Database sessions
  are not supported with it, so `id` and `role` ride on the JWT via the `jwt`
  and `session` callbacks. The Drizzle adapter is still used for user storage.
- **Zod is v4**: use `z.email()` / `z.uuid()`, not `z.string().email()`.
- **npm blocks install scripts.** `sharp` and `esbuild` are approved in
  `package.json` under `allowScripts`; a fresh `npm install` on another machine
  may need `npm approve-scripts`.
- **RustFS needs `forcePathStyle: true`** on the S3 client, same as MinIO.
  Backblaze B2 accepts path-style too, so it stays on by default.
- **Do not remove `requestChecksumCalculation: "WHEN_REQUIRED"`** from the S3
  client. Since v3.729 the AWS SDK attaches `x-amz-checksum-crc32` to every
  upload, and B2 rejects it with `400 Unsupported header ... for this API call`.
  RustFS tolerates the header, so dropping this breaks production while local
  development keeps working — a nasty way to find out.

## Conventions

- Reads live in `src/lib/queries.ts`, writes in `src/lib/actions/`. Both call
  `verifySession()` first.
- Photo objects are content-addressed: `<sha256[0:2]>/<sha256>/{orig,thumb}.<ext>`.
  Dedupe is by the `photos.checksum` unique index.
- The bucket is private. Never generate public or presigned URLs for photos —
  stream them through `/api/photos/[id]/[variant]`, which checks the session.
- Styling is Tailwind v4 with semantic colours (`bg-paper`, `text-ink`,
  `border-line`, `accent`) defined in `src/app/globals.css`. Use those rather
  than raw palette colours so light/dark both work.
- After schema edits: `npm run db:generate` then `npm run db:migrate`.
