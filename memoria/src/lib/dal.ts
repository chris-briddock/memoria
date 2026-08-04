import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "member";
};

/**
 * The single place authorization is decided. Every server component, server
 * action and route handler that touches family data calls this first —
 * `proxy.ts` only does an optimistic redirect and is not a security boundary.
 */
export const verifySession = cache(async (): Promise<SessionUser> => {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? null,
    role: session.user.role ?? "member",
  };
});

/** Like `verifySession` but returns null instead of redirecting. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? null,
    role: session.user.role ?? "member",
  };
});

export async function requireAdmin(): Promise<SessionUser> {
  const user = await verifySession();
  if (user.role !== "admin") redirect("/");
  return user;
}
