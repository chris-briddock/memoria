import Link from "next/link";
import { signOutAction } from "@/lib/actions/auth";
import type { SessionUser } from "@/lib/dal";

const links = [
  { href: "/", label: "Photos" },
  { href: "/albums", label: "Albums" },
];

const navLinkClass =
  "rounded-sm px-3 py-2.5 text-xs font-medium uppercase tracking-[0.12em] text-ink-soft transition hover:text-ink hover:underline hover:decoration-accent hover:decoration-2 hover:underline-offset-8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function Nav({ user }: Readonly<{ user: SessionUser }>) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-5">
        <Link
          href="/"
          className="font-display text-xl font-semibold tracking-tight text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Memoria<span className="text-accent">.</span>
        </Link>

        <nav className="flex items-center gap-1">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={navLinkClass}>
              {link.label}
            </Link>
          ))}
          <Link href="/settings" className={navLinkClass}>
            Settings
          </Link>
          {user.role === "admin" && (
            <Link href="/settings/family" className={navLinkClass}>
              Family
            </Link>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-xs tracking-wide text-ink-faint sm:inline">
            {user.name ?? user.email}
          </span>
          <form action={signOutAction}>
            <button type="submit" className="btn-ghost min-h-9 px-3 py-1.5">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
