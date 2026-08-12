"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { SessionUser } from "@/lib/types";
import type { NavLink } from "@/components/nav-links";
import { SignOutButton } from "@/components/sign-out-button";

type Props = {
  user: SessionUser;
  links: NavLink[];
};

/**
 * Collapsible nav for narrow viewports. Renders a hamburger button that opens
 * a dropdown with the primary links, the signed-in identity and sign-out —
 * none of which fit on a phone-width header. Closes on route change, Escape,
 * and pointer-down outside the panel. Hidden at ≥768px where the inline nav
 * takes over.
 *
 * `SignOutButton` is already a client component, so it can be nested directly
 * without a server/client hand-off.
 */
export function MobileNavMenu({ user, links }: Readonly<Props>) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  // Close after any navigation (menu links and the footer sign-out alike) by
  // adjusting state during render when the route changes — the pattern React
  // recommends over setting state from an effect.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const linkClass =
    "block rounded-md px-3 py-3 text-sm font-medium uppercase tracking-[0.12em] text-ink-soft transition hover:bg-paper-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  return (
    <div ref={rootRef} className="relative ml-auto md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
        className="btn-ghost min-h-11 min-w-11 px-3"
      >
        {open ? (
          // X icon
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        ) : (
          // Hamburger icon
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
          </svg>
        )}
      </button>

      {open && (
        <div
          id={menuId}
          className="absolute right-0 top-full z-30 mt-2 w-64 rounded-lg border border-line bg-paper p-2 shadow-lg"
        >
          <nav aria-label="Primary" className="flex flex-col gap-0.5">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className={linkClass}>
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="mt-2 border-t border-line px-3 pb-2 pt-3">
            <p className="truncate text-xs tracking-wide text-ink-faint">
              {user.name ?? user.email}
            </p>
            <div className="mt-2">
              <SignOutButton />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
