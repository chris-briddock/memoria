import { describe, expect, it } from "vitest";
import { objectKey } from "@/lib/storage";

describe("objectKey", () => {
  it("shards by the checksum's two-character prefix", () => {
    const checksum = "abcdef0123456789";
    expect(objectKey(checksum, "orig", "jpg")).toBe(
      "ab/abcdef0123456789/orig.jpg",
    );
  });

  it("embeds variant and extension", () => {
    expect(objectKey("ff00ff00", "thumb", "webp")).toBe(
      "ff/ff00ff00/thumb.webp",
    );
  });

  it("handles short checksums without error", () => {
    expect(objectKey("a1", "orig", "png")).toBe("a1/a1/orig.png");
  });
});
