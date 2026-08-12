import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { logger } from "@/lib/logger";
import type { SessionUser } from "@/lib/types";

export type { SessionUser };

const log = logger("dal");

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
  if (!session?.user?.id) {
    // Expected for anonymous traffic — debug, not warn — but recorded: a wave
    // of these against a route that should only see members is the first
    // signal of a broken session or an attack.
    log.debug("no session found for request");
    return null;
  }
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? null,
    role: session.user.role ?? "member",
  };
});

export async function requireAdmin(): Promise<SessionUser> {
  const user = await verifySession();
  if (user.role !== "admin") {
    // A signed-in member poking an admin surface — noteworthy, not routine.
    log.warn("non-admin redirected from admin-only surface", { user_id: user.id, role: user.role });
    redirect("/");
  }
  return user;
}
