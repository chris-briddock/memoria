import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/signin", "/register"];

/**
 * Optimistic only: it checks for the presence of a session cookie so signed-out
 * visitors bounce to /signin without a database round trip. It deliberately
 * does not verify the token — real authorization lives in `src/lib/dal.ts`,
 * next to the data.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasSessionCookie =
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token");

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!hasSessionCookie && !isPublic) {
    const signin = new URL("/signin", request.url);
    signin.searchParams.set("next", pathname);
    return NextResponse.redirect(signin);
  }

  if (hasSessionCookie && isPublic) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals, the auth endpoints themselves, and static files.
  // Must be a plain string literal: Next statically analyzes this export and
  // cannot evaluate a tagged template like String.raw`...`.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
