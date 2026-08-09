import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public endpoint: is this a brand-new vault with no users yet?
 *
 * Uses an existence check (LIMIT 1), not COUNT(*), so it stays O(1) as the
 * vault grows to billions of users — COUNT(*) forces a full table scan under
 * Postgres MVCC, which no index can satisfy. This mirrors the bootstrap
 * decision made inline by the register route, keeping the two in lockstep.
 */
export async function GET() {
  const anyUser = await db.select({ id: users.id }).from(users).limit(1);
  return NextResponse.json({ bootstrap: anyUser.length === 0 });
}
