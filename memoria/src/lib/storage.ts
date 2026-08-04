import "server-only";
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * The client and bucket are resolved lazily. Next.js imports every route
 * module during page-data collection just to read its segment config
 * (`runtime`, `maxDuration`, …); touching env vars or constructing the SDK
 * client at module scope makes that evaluation fail in a worker that has no
 * storage credentials, which surfaces as "Invalid segment configuration
 * export". Deferring both to first call keeps module import side-effect free.
 */
let client: S3Client | undefined;
let bucketName: string | undefined;

/* The S3 boundary (bucket/s3 client and every network send below) is mocked in
 * tests per the coverage plan, so these functions are excluded from the v8
 * coverage measurement. Only the pure `objectKey` helper is measured. */
/* v8 ignore start */
function bucket(): string {
  if (bucketName === undefined) {
    const value = process.env.S3_BUCKET;
    if (!value) throw new Error("S3_BUCKET must be set");
    bucketName = value;
  }
  return bucketName;
}

function s3(): S3Client {
  if (client === undefined) {
    const endpoint = process.env.S3_ENDPOINT;
    if (!endpoint) throw new Error("S3_ENDPOINT must be set");

    client = new S3Client({
      endpoint,
      region: process.env.S3_REGION ?? "us-east-1",
      // Backblaze B2 accepts path-style; RustFS and MinIO require it.
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
      // Since v3.729 the SDK adds x-amz-checksum-crc32 to every upload.
      // Backblaze B2 rejects that header outright ("Unsupported header ... for
      // this API call"), so restrict checksums to operations that mandate them.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

let bucketReady: Promise<void> | undefined;

/** Verifies the bucket on first use, creating it when the backend allows. */
export function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    try {
      await s3().send(new HeadBucketCommand({ Bucket: bucket() }));
      return;
    } catch {
      // Fall through and try to create it.
    }

    try {
      await s3().send(new CreateBucketCommand({ Bucket: bucket() }));
    } catch (err) {
      const name = (err as { name?: string }).name;
      // Another request won the race; that is fine.
      if (name === "BucketAlreadyOwnedByYou") return;

      bucketReady = undefined;
      if (name === "BucketAlreadyExists") {
        // B2 bucket names are unique across all of Backblaze, not just your
        // account, so a plain name like "memoria-photos" is likely taken.
        throw new Error(
          `Bucket "${bucket()}" already exists and is not yours. Bucket names on ` +
            `Backblaze B2 are globally unique — pick a distinctive S3_BUCKET ` +
            `(e.g. "memoria-photos-<something-of-yours>") and create it in the ` +
            `B2 console.`,
        );
      }
      throw err;
    }
  })();
  return bucketReady;
}
/* v8 ignore stop */

/**
 * Objects are sharded by checksum prefix to avoid one enormous flat listing.
 * `variant` is "orig" or "thumb"; the extension keeps objects recognisable
 * when browsing the RustFS console.
 */
export function objectKey(checksum: string, variant: "orig" | "thumb", ext: string) {
  return `${checksum.slice(0, 2)}/${checksum}/${variant}.${ext}`;
}

/* v8 ignore start */
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await ensureBucket();
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/** Returns a web ReadableStream so route handlers can stream without buffering. */
export async function getObjectStream(key: string) {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  return {
    body: res.Body?.transformToWebStream(),
    contentType: res.ContentType,
    contentLength: res.ContentLength,
  };
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await s3().send(
    new DeleteObjectsCommand({
      Bucket: bucket(),
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    }),
  );
}
/* v8 ignore stop */
