import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/storage", () => ({ objectKey: vi.fn(), putObject: vi.fn() }));

import { extensionFor } from "@/lib/ingest";

describe("extensionFor", () => {
  it.each([
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/avif", "avif"],
    ["image/gif", "gif"],
    ["image/tiff", "tiff"],
    ["image/heic", "heic"],
    ["image/heif", "heic"],
  ])("maps %s to %s", (mime, ext) => {
    expect(extensionFor(mime)).toBe(ext);
  });

  it("defaults to jpg for jpeg and unknown types", () => {
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("application/pdf")).toBe("jpg");
  });
});
