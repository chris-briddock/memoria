import { NextResponse } from "next/server";
import { signOut } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign out. `signOut()` throws a redirect, which we catch and convert to JSON
 * `{ redirect }` the client acts on.
 */
export async function POST() {
  try {
    await signOut({ redirectTo: "/signin" });
    // Unreachable: signOut throws on success.
    return NextResponse.json({ ok: true, redirect: "/signin" });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT")) {
      return NextResponse.json({ ok: true, redirect: "/signin" });
    }
    throw error;
  }
}
