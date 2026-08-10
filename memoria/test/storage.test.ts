import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The S3 boundary is mocked: capture every `send` per constructed client so
// dual-backend behaviour (primary + replica) can be asserted without network.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => {
  class FakeCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class S3Client {
    send = sendMock;
  }
  return {
    S3Client,
    PutObjectCommand: FakeCommand,
    GetObjectCommand: FakeCommand,
    DeleteObjectsCommand: FakeCommand,
    HeadBucketCommand: FakeCommand,
    CreateBucketCommand: FakeCommand,
  };
});

const PRIMARY_ENV = {
  S3_ENDPOINT: "https://primary.example.com",
  S3_REGION: "auto",
  S3_BUCKET: "primary-bucket",
  S3_ACCESS_KEY_ID: "primary-key",
  S3_SECRET_ACCESS_KEY: "primary-secret",
};

const REPLICA_ENV = {
  S3_REPLICA_ENDPOINT: "https://replica.example.com",
  S3_REPLICA_REGION: "eu-central-003",
  S3_REPLICA_BUCKET: "replica-bucket",
  S3_REPLICA_ACCESS_KEY_ID: "replica-key",
  S3_REPLICA_SECRET_ACCESS_KEY: "replica-secret",
};

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** Fresh module instance per test: the backend cache lives at module scope. */
async function loadStorage(env: Record<string, string | undefined>) {
  setEnv(env);
  vi.resetModules();
  return import("@/lib/storage");
}

const ALL_ENV_KEYS = [...Object.keys(PRIMARY_ENV), ...Object.keys(REPLICA_ENV)];

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({});
});

afterEach(() => {
  setEnv(Object.fromEntries(ALL_ENV_KEYS.map((k) => [k, undefined])));
  vi.restoreAllMocks();
});

describe("objectKey", () => {
  it("shards by the checksum's two-character prefix", async () => {
    const { objectKey } = await loadStorage({});
    expect(objectKey("abcdef0123456789", "orig", "jpg")).toBe(
      "ab/abcdef0123456789/orig.jpg",
    );
  });

  it("embeds variant and extension", async () => {
    const { objectKey } = await loadStorage({});
    expect(objectKey("ff00ff00", "thumb", "webp")).toBe("ff/ff00ff00/thumb.webp");
  });

  it("handles short checksums without error", async () => {
    const { objectKey } = await loadStorage({});
    expect(objectKey("a1", "orig", "png")).toBe("a1/a1/orig.png");
  });
});

describe("backend configuration", () => {
  it("requires the primary bucket and endpoint together", async () => {
    const { putObject } = await loadStorage({ S3_BUCKET: "only-bucket" });
    await expect(putObject("k", Buffer.from("x"), "image/png")).rejects.toThrow(
      /must be set together/,
    );
  });

  it("rejects a half-configured replica", async () => {
    const { putObject } = await loadStorage({
      ...PRIMARY_ENV,
      S3_REPLICA_BUCKET: "replica-bucket",
    });
    await expect(putObject("k", Buffer.from("x"), "image/png")).rejects.toThrow(
      /S3_REPLICA_ENDPOINT and S3_REPLICA_BUCKET must be set together/,
    );
  });
});

describe("putObject", () => {
  const KEY = "ab/abcdef/orig.png";
  const BODY = Buffer.from("bytes");

  it("writes only to the primary when no replica is configured", async () => {
    const { putObject } = await loadStorage(PRIMARY_ENV);
    await putObject(KEY, BODY, "image/png");

    const puts = sendMock.mock.calls.filter(
      ([cmd]) => (cmd as { input?: { Key?: string } }).input?.Key === KEY,
    );
    // One PutObject, to the primary bucket only.
    expect(puts).toHaveLength(1);
    expect((puts[0][0] as { input: { Bucket: string } }).input.Bucket).toBe(
      "primary-bucket",
    );
  });

  it("writes to both backends when a replica is configured", async () => {
    const { putObject } = await loadStorage({ ...PRIMARY_ENV, ...REPLICA_ENV });
    await putObject(KEY, BODY, "image/png");

    const buckets = sendMock.mock.calls
      .map(([cmd]) => (cmd as { input?: { Bucket?: string; Key?: string } }).input)
      .filter((input) => input?.Key === KEY)
      .map((input) => input?.Bucket);
    expect(buckets).toContain("primary-bucket");
    expect(buckets).toContain("replica-bucket");
  });

  it("succeeds when the replica write fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sendMock.mockImplementation((cmd: { input?: { Bucket?: string } }) => {
      if (cmd.input?.Bucket === "replica-bucket") {
        return Promise.reject(new Error("replica down"));
      }
      return Promise.resolve({});
    });

    const { putObject } = await loadStorage({ ...PRIMARY_ENV, ...REPLICA_ENV });
    await expect(putObject(KEY, BODY, "image/png")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("replica put failed"),
      expect.anything(),
    );
  });

  it("fails when the primary write fails, even if the replica succeeded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendMock.mockImplementation((cmd: { input?: { Bucket?: string } }) => {
      if (cmd.input?.Bucket === "primary-bucket") {
        return Promise.reject(new Error("primary down"));
      }
      return Promise.resolve({});
    });

    const { putObject } = await loadStorage({ ...PRIMARY_ENV, ...REPLICA_ENV });
    await expect(putObject(KEY, BODY, "image/png")).rejects.toThrow("primary down");
  });
});

describe("getObjectStream", () => {
  const KEY = "ab/abcdef/orig.png";

  function fakeGetObject(bucket: string) {
    return {
      Body: { transformToWebStream: () => `stream-from-${bucket}` },
      ContentType: "image/png",
      ContentLength: 5,
    };
  }

  it("serves from the primary on the happy path", async () => {
    sendMock.mockImplementation((cmd: { input?: { Bucket?: string } }) =>
      Promise.resolve(fakeGetObject(cmd.input?.Bucket ?? "unknown")),
    );

    const { getObjectStream } = await loadStorage({ ...PRIMARY_ENV, ...REPLICA_ENV });
    const object = await getObjectStream(KEY);

    expect(object.body).toBe("stream-from-primary-bucket");
    expect(object.contentType).toBe("image/png");
  });

  it("falls back to the replica when the primary read fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    sendMock.mockImplementation((cmd: { input?: { Bucket?: string } }) => {
      if (cmd.input?.Bucket === "primary-bucket") {
        return Promise.reject(new Error("primary 503"));
      }
      return Promise.resolve(fakeGetObject(cmd.input?.Bucket ?? "unknown"));
    });

    const { getObjectStream } = await loadStorage({ ...PRIMARY_ENV, ...REPLICA_ENV });
    const object = await getObjectStream(KEY);

    expect(object.body).toBe("stream-from-replica-bucket");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("falling back to replica"),
      expect.anything(),
    );
  });

  it("rethrows the primary error when no replica is configured", async () => {
    sendMock.mockRejectedValue(new Error("primary 503"));

    const { getObjectStream } = await loadStorage(PRIMARY_ENV);
    await expect(getObjectStream(KEY)).rejects.toThrow("primary 503");
  });

  it("rethrows the replica error when both backends miss", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sendMock.mockRejectedValue(new Error("NoSuchKey"));

    const { getObjectStream } = await loadStorage({ ...PRIMARY_ENV, ...REPLICA_ENV });
    await expect(getObjectStream(KEY)).rejects.toThrow("NoSuchKey");
  });
});

describe("deleteObjects", () => {
  const KEYS = ["ab/abcdef/orig.png", "ab/abcdef/thumb.webp"];

  it("is a no-op for an empty key list", async () => {
    const { deleteObjects } = await loadStorage(PRIMARY_ENV);
    await deleteObjects([]);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("deletes from both backends when a replica is configured", async () => {
    const { deleteObjects } = await loadStorage({ ...PRIMARY_ENV, ...REPLICA_ENV });
    await deleteObjects(KEYS);

    const buckets = sendMock.mock.calls.map(
      ([cmd]) => (cmd as { input?: { Bucket?: string } }).input?.Bucket,
    );
    expect(buckets).toContain("primary-bucket");
    expect(buckets).toContain("replica-bucket");
  });

  it("succeeds when the replica delete fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sendMock.mockImplementation((cmd: { input?: { Bucket?: string } }) => {
      if (cmd.input?.Bucket === "replica-bucket") {
        return Promise.reject(new Error("replica down"));
      }
      return Promise.resolve({});
    });

    const { deleteObjects } = await loadStorage({ ...PRIMARY_ENV, ...REPLICA_ENV });
    await expect(deleteObjects(KEYS)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("replica delete failed"),
      expect.anything(),
    );
  });

  it("fails when the primary delete fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendMock.mockImplementation((cmd: { input?: { Bucket?: string } }) => {
      if (cmd.input?.Bucket === "primary-bucket") {
        return Promise.reject(new Error("primary down"));
      }
      return Promise.resolve({});
    });

    const { deleteObjects } = await loadStorage({ ...PRIMARY_ENV, ...REPLICA_ENV });
    await expect(deleteObjects(KEYS)).rejects.toThrow("primary down");
  });
});
