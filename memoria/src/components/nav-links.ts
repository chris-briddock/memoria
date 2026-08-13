import type { SessionUser } from "@/lib/types";

export type NavLink = {
  href: string;
  label: string;
};

const baseLinks: NavLink[] = [
  { href: "/", label: "Photos" },
  { href: "/albums", label: "Albums" },
  { href: "/import", label: "Import" },
  { href: "/settings", label: "Settings" },
];

/**
 * Primary destinations shown to a user. The Family surface is admin-only, so
 * members never see a link that would redirect them away.
 */
export function getNavLinks(user: SessionUser): NavLink[] {
  if (user.role !== "admin") return baseLinks;
  return [...baseLinks, { href: "/settings/family", label: "Family" }];
}
