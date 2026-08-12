import Link from "next/link";
import type { SessionUser } from "@/lib/types";
import { SignOutButton } from "@/components/sign-out-button";
import { MobileNavMenu } from "@/components/nav-mobile-menu";
import { getNavLinks } from "@/components/nav-links";

const navLinkClass =
  "rounded-sm px-3 py-2.5 text-xs font-medium uppercase tracking-[0.12em] text-ink-soft transition hover:text-ink hover:underline hover:decoration-accent hover:decoration-2 hover:underline-offset-8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function Nav({ user }: Readonly<{ user: SessionUser }>) {
  const links = getNavLinks(user);

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-5">
        <Link
          href="/"
          className="font-display text-xl font-semibold tracking-tight text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Memoria<span className="text-accent">.</span>
        </Link>

        {/* Inline links and identity need the width of a tablet or larger; on
            phones the hamburger menu below takes over. */}
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={navLinkClass}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-3 md:flex">
          <span className="text-xs tracking-wide text-ink-faint">
            {user.name ?? user.email}
          </span>
          <SignOutButton />
        </div>

        <MobileNavMenu user={user} links={links} />
      </div>
    </header>
  );
}
