"use client";

/**
 * Client-side helper for form components to submit mutations via HTTP.
 *
 * Replaces `useActionState` / `<form action={serverAction}>`. The form serialises
 * to `FormData` (or a plain object) and the helper POSTs it to the given API
 * route, returning a normalised `{ ok, error, data }` result the component
 * renders.
 */
export type ApiResult<T = unknown> = {
  ok: boolean;
  error: string | null;
  data: T | null;
};

export async function apiSubmit<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init.method ?? "POST",
      headers:
        init.body instanceof FormData
          ? undefined
          : { "Content-Type": "application/json" },
      ...init,
    });

    const body = (await res.json().catch(() => null)) as
      | Record<string, unknown>
      | null;

    if (!res.ok) {
      return { ok: false, error: (body?.error as string) ?? "Request failed.", data: null };
    }

    if (body && typeof body === "object" && "error" in body && body.error) {
      return { ok: false, error: body.error as string, data: null };
    }

    return { ok: true, error: null, data: (body as T) ?? null };
  } catch {
    return { ok: false, error: "Network error.", data: null };
  }
}
