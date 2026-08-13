import { describe, expect, it } from "vitest";
import { getNavLinks } from "@/components/nav-links";
import type { SessionUser } from "@/lib/types";

function user(role: SessionUser["role"]): SessionUser {
  return { id: "u1", email: "u@example.com", name: "User", role };
}

describe("getNavLinks", () => {
  it("gives members the core destinations without the Family link", () => {
    const links = getNavLinks(user("member"));
    expect(links.map((l) => l.href)).toEqual(["/", "/albums", "/import", "/settings"]);
  });

  it("gives admins the member links plus the Family settings", () => {
    const links = getNavLinks(user("admin"));
    expect(links.map((l) => l.href)).toEqual([
      "/",
      "/albums",
      "/import",
      "/settings",
      "/settings/family",
    ]);
    expect(links.at(-1)?.label).toBe("Family");
  });

  it("does not mutate the shared link list between calls", () => {
    getNavLinks(user("admin"));
    expect(getNavLinks(user("member")).map((l) => l.href)).toHaveLength(4);
  });
});
