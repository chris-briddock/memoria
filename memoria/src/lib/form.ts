/**
 * `formData.get()` returns a `File` when a file input shares the field name;
 * coercing it with `String()` would silently turn it into "[object File]"
 * (typescript:S6551). Only accept genuine strings, treating absent/binary
 * values as empty.
 *
 * Kept out of the `"use server"` action modules: every export from one of
 * those must be an async function, and this helper is synchronous.
 */
export function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
