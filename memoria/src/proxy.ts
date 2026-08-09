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
  // Skip Next internals, *all* API routes, and static files.
  // API route handlers enforce their own auth (see `src/lib/dal.ts`), so the
  // optimistic cookie check here must not touch them — otherwise a public
  // endpoint such as GET /api/bootstrap would be 307-redirected to /signin
  // when a signed-out visitor loads the sign-in page.
  // Must be a plain string literal: Next statically analyzes this export and
  // cannot evaluate a tagged template like String.raw`...`.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
