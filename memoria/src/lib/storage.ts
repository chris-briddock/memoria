import "server-only";
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { logger } from "@/lib/logger";

const log = logger("storage");

/**
 * Storage is dual-homed: a primary backend (the unprefixed `S3_*` vars) and an
 * optional replica (`S3_REPLICA_*`). Writes go to both — a primary failure
 * fails the operation, a replica failure is only logged, so a degraded
 * replica never takes the vault down. Reads fall back to the replica when the
 * primary cannot serve an object, which keeps photos available through a
 * primary outage. Deletes target both; a replica miss leaves an invisible
 * orphan rather than an error.
 *
 * Both backends speak the S3 API (R2, B2, RustFS, MinIO), so one client class
 * serves both. Keys are checksum-derived (`objectKey`), so the two buckets
 * hold byte-identical layouts and can be reconciled by diffing listings.
 */

type Backend = {
  name: string;
  bucket: string;
  client: S3Client;
  /** Ensured at most once per process; see ensureBucket. */
  ready?: Promise<void>;
};

/**
 * Backends are resolved lazily. Next.js imports every route module during
 * page-data collection just to read its segment config (`runtime`,
 * `maxDuration`, …); touching env vars or constructing the SDK client at
 * module scope makes that evaluation fail in a worker that has no storage
 * credentials, which surfaces as "Invalid segment configuration export".
 * Deferring both to first call keeps module import side-effect free.
 */
let cachedBackends: { primary: Backend; replica: Backend | null } | undefined;

/* v8 ignore start */
function backendFromEnv(prefix: string): Backend | null {
  const endpoint = process.env[`${prefix}ENDPOINT`];
  const bucketName = process.env[`${prefix}BUCKET`];
  // Both or neither: a half-configured backend is a configuration error worth
  // surfacing loudly rather than silently skipping replication.
  if (!endpoint && !bucketName) return null;
  if (!endpoint || !bucketName) {
    throw new Error(
      `${prefix}ENDPOINT and ${prefix}BUCKET must be set together (got ` +
        `${endpoint ? "endpoint only" : "bucket only"})`,
    );
  }

  return {
    // "S3_" -> "primary", "S3_REPLICA_" -> "replica"; used in log lines.
    name: prefix === "S3_" ? "primary" : "replica",
    bucket: bucketName,
    client: new S3Client({
      endpoint,
      region: process.env[`${prefix}REGION`] ?? "us-east-1",
      // Backblaze B2 accepts path-style; RustFS and MinIO require it. R2
      // accepts both. The flag applies per-backend via the same prefix.
      forcePathStyle: process.env[`${prefix}FORCE_PATH_STYLE`] !== "false",
      credentials: {
        accessKeyId: process.env[`${prefix}ACCESS_KEY_ID`]!,
        secretAccessKey: process.env[`${prefix}SECRET_ACCESS_KEY`]!,
      },
      // Since v3.729 the SDK adds x-amz-checksum-crc32 to every upload.
      // Backblaze B2 rejects that header outright ("Unsupported header ... for
      // this API call"), so restrict checksums to operations that mandate them.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  };
}

function backends(): { primary: Backend; replica: Backend | null } {
  if (cachedBackends === undefined) {
    const primary = backendFromEnv("S3_");
    if (!primary) {
      throw new Error("S3_ENDPOINT and S3_BUCKET must be set");
    }
    cachedBackends = { primary, replica: backendFromEnv("S3_REPLICA_") };
  }
  return cachedBackends;
}

/** Verifies the bucket on first use, creating it when the backend allows. */
function ensureBucket(backend: Backend): Promise<void> {
  backend.ready ??= (async () => {
    try {
      await backend.client.send(new HeadBucketCommand({ Bucket: backend.bucket }));
      return;
    } catch {
      // Fall through and try to create it.
    }

    try {
      await backend.client.send(new CreateBucketCommand({ Bucket: backend.bucket }));
    } catch (err) {
      const name = (err as { name?: string }).name;
      // Another request won the race; that is fine.
      if (name === "BucketAlreadyOwnedByYou") return;

      backend.ready = undefined;
      if (name === "BucketAlreadyExists") {
        // B2 bucket names are unique across all of Backblaze, not just your
        // account, so a plain name like "memoria-photos" is likely taken.
        throw new Error(
          `Bucket "${backend.bucket}" already exists and is not yours. Bucket names on ` +
            `Backblaze B2 are globally unique — pick a distinctive bucket name ` +
            `(e.g. "memoria-photos-<something-of-yours>") and create it in the ` +
            `provider's console.`,
        );
      }
      throw err;
    }
  })();
  return backend.ready;
}
/* v8 ignore stop */

/**
 * Objects are sharded by checksum prefix to avoid one enormous flat listing.
 * `variant` is "orig" or "thumb"; the extension keeps objects recognisable
 * when browsing a storage console.
 */
export function objectKey(checksum: string, variant: "orig" | "thumb", ext: string) {
  return `${checksum.slice(0, 2)}/${checksum}/${variant}.${ext}`;
}

/**
 * Replica failures are logged, not thrown: the primary holds the data and a
 * hard down replica must not break uploads, reads, or deletes. The price is
 * temporary drift until someone re-syncs (diff the two listings — keys are
 * identical by construction).
 */
function reportReplicaFailure(op: string, key: string, err: unknown): void {
  log.error(
    `replica ${op} failed; primary succeeded, replica has drifted (out of sync)`,
    { op, key },
    err,
  );
}

/* v8 ignore start */
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const { primary, replica } = backends();

  async function put(backend: Backend): Promise<void> {
    await ensureBucket(backend);
    await backend.client.send(
      new PutObjectCommand({
        Bucket: backend.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  if (!replica) {
    await put(primary);
    return;
  }

  // Parallel: the two providers are independent, and a slow replica should not
  // add its latency to the primary write on top of its failure modes.
  const [primaryResult, replicaResult] = await Promise.allSettled([
    put(primary),
    put(replica),
  ]);

  if (primaryResult.status === "rejected") {
    // Primary holds the system of record; its failure fails the upload. The
    // replica copy (if it landed) is an orphan keyed identically, so a later
    // retry simply overwrites it.
    throw primaryResult.reason;
  }
  if (replicaResult.status === "rejected") {
    reportReplicaFailure("put", key, replicaResult.reason);
  }
}

/** Returns a web ReadableStream so route handlers can stream without buffering. */
export async function getObjectStream(key: string) {
  const { primary, replica } = backends();

  async function get(backend: Backend) {
    const res = await backend.client.send(
      new GetObjectCommand({ Bucket: backend.bucket, Key: key }),
    );
    return {
      body: res.Body?.transformToWebStream(),
      contentType: res.ContentType,
      contentLength: res.ContentLength,
    };
  }

  try {
    return await get(primary);
  } catch (err) {
    if (!replica) throw err;
    log.warn("primary read failed, falling back to replica", { key }, err);
    // A replica miss here means the object was never replicated (or the
    // replica is down too) — either way the caller sees the throw, same as a
    // single-backend miss.
    return get(replica);
  }
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const { primary, replica } = backends();

  async function del(backend: Backend): Promise<void> {
    await backend.client.send(
      new DeleteObjectsCommand({
        Bucket: backend.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      }),
    );
  }

  if (!replica) {
    await del(primary);
    return;
  }

  const [primaryResult, replicaResult] = await Promise.allSettled([
    del(primary),
    del(replica),
  ]);

  if (primaryResult.status === "rejected") {
    throw primaryResult.reason;
  }
  if (replicaResult.status === "rejected") {
    reportReplicaFailure("delete", keys.join(", "), replicaResult.reason);
  }
}
/* v8 ignore stop */
