import { describe, expect, it } from "vitest";
import { formatBytes } from "@/lib/format";

describe("formatBytes", () => {
  it("formats zero bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats whole bytes with no decimal", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats kilobytes with one decimal", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(1024 ** 2)).toBe("1.0 MB");
    expect(formatBytes(2.5 * 1024 ** 2)).toBe("2.5 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
  });

  it("formats terabytes", () => {
    expect(formatBytes(1024 ** 4)).toBe("1.0 TB");
  });

  it("caps at TB for very large values", () => {
    expect(formatBytes(1024 ** 5)).toBe("1024.0 TB");
  });
});
