import { describe, expect, it } from "vitest";
import { groupByMonth, type GridPhoto } from "@/components/photo-grid";

function photo(id: string, takenAt: Date | null): GridPhoto {
  return {
    id,
    caption: null,
    originalFilename: `${id}.jpg`,
    width: 100,
    height: 100,
    takenAt,
    favorite: false,
  };
}

describe("groupByMonth", () => {
  it("returns an empty list for no photos", () => {
    expect(groupByMonth([])).toEqual([]);
  });

  it("groups photos into their calendar month", () => {
    const a = photo("a", new Date(2025, 0, 10)); // January 2025
    const b = photo("b", new Date(2025, 0, 25)); // January 2025
    const c = photo("c", new Date(2024, 11, 5)); // December 2024

    const months = groupByMonth([a, b, c]);

    expect(months).toHaveLength(2);
    const jan = months.find((m) => m.key === "2025-01");
    expect(jan?.photos.map((p) => p.id)).toEqual(["a", "b"]);
    expect(jan?.label).toBe("January 2025");
    const dec = months.find((m) => m.key === "2024-12");
    expect(dec?.photos.map((p) => p.id)).toEqual(["c"]);
  });

  it("orders months newest first", () => {
    const photos = [
      photo("old", new Date(2023, 5, 1)),
      photo("new", new Date(2025, 2, 1)),
      photo("mid", new Date(2024, 8, 1)),
    ];
    expect(groupByMonth(photos).map((m) => m.key)).toEqual([
      "2025-03",
      "2024-09",
      "2023-06",
    ]);
  });

  it("places photos with no capture date in the January 1970 fallback group", () => {
    const months = groupByMonth([photo("x", null)]);
    expect(months).toHaveLength(1);
    expect(months[0].key).toBe("1970-01");
    expect(months[0].label).toBe("January 1970");
  });
});
