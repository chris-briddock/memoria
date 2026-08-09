import "server-only";
import { headers } from "next/headers";

/**
 * Server-side helper for Server Components to read their own API routes.
 *
 * The `/api/...` route handlers are the single, explicit boundary that exposes
 * the database queries. A Server Component reaches them over HTTP, forwarding
 * the session cookie so the request is authenticated exactly as the browser's
 * own call would be. Pages never import `db`, `queries`, or `dal` directly.
 *
 * The base URL is taken from the incoming request's `host`/`x-forwarded-proto`
 * headers — the same authority the browser used — so the loopback always
 * targets the server that is actually serving this request.
 */
export async function apiGet<T>(path: string): Promise<T | null> {
  const headerList = await headers();
  const protocol = headerList.get("x-forwarded-proto") ?? "http";
  const host = headerList.get("host") ?? "localhost:3000";
  const cookie = headerList.get("cookie");

  const res = await fetch(`${protocol}://${host}${path}`, {
    headers: cookie ? { cookie } : {},
    cache: "no-store",
    // Auth failures inside a route handler call `redirect("/signin")`, which
    // produces a 3xx to /signin. Following it would fetch HTML and fail JSON
    // parsing opaquely; treat any redirect as an auth boundary instead.
    redirect: "manual",
  });

  if (res.status >= 300 && res.status < 400) {
    throw new Error(`GET ${path} redirected (unauthenticated): ${res.status}`);
  }

  // A missing resource is a normal "not found", not an error. Returning null
  // lets the caller do `if (!row) notFound()` instead of the throw bubbling
  // up and turning a 404 route into an unhandled 500 page render. Anything
  // else (5xx, 403, …) stays loud so genuine failures aren't swallowed.
  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed: ${res.status} ${body}`.trim());
  }

  return (await res.json()) as T;
}

/**
 * Variant of {@link apiGet} for endpoints that never return 404 — list routes,
 * `/api/me`, `/api/bootstrap`, etc. It asserts the body is present, turning an
 * unexpected 404 into a loud error instead of silently yielding `null`. Use
 * plain {@link apiGet} for single-resource routes (`/api/photos/[id]`) where a
 * missing row should render `notFound()`.
 */
export async function apiGetRequired<T>(path: string): Promise<T> {
  const result = await apiGet<T>(path);
  if (result === null) {
    throw new Error(`GET ${path} returned an unexpected 404`);
  }
  return result;
}
