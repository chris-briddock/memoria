import { describe, expect, it } from "vitest";
import { field } from "@/lib/form";

function formDataOf(entries: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("field", () => {
  it("returns the string value for a present field", () => {
    expect(field(formDataOf({ caption: "Beach day" }), "caption")).toBe(
      "Beach day",
    );
  });

  it("returns empty string for a missing field", () => {
    expect(field(formDataOf({}), "missing")).toBe("");
  });

  it("returns empty string when the value is a File (S6551 coercion guard)", () => {
    const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });
    expect(field(formDataOf({ caption: file }), "caption")).toBe("");
  });
});
