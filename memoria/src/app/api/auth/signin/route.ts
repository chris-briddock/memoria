import { NextResponse } from "next/server";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { field } from "@/lib/form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Credential sign-in. `signIn()` throws a redirect on success, which we catch
 * and convert into a JSON `{ redirect }` the client acts on. AuthError becomes
 * a friendly `{ error }`.
 */
export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const next = field(formData, "next") || "/";
  const redirectTo = next.startsWith("/") ? next : "/";

  try {
    await signIn("credentials", {
      email: field(formData, "email").toLowerCase(),
      password: field(formData, "password"),
      redirectTo,
    });
    // Unreachable: signIn throws on success.
    return NextResponse.json({ ok: true, redirect: redirectTo });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: "That email and password combination isn't right." },
        { status: 400 },
      );
    }
    // The success redirect: extract the destination and return it as JSON.
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT")) {
      return NextResponse.json({ ok: true, redirect: redirectTo });
    }
    throw error;
  }
}
