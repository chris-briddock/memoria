// Integration test for the DB-backed invite helpers in @/lib/oauth, against
// the disposable `memoria_test` database (see test/setup.ts).
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The cookie helpers need next/headers; the invite queries do not. Provide a
// minimal jar so module evaluation never touches a request context.
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  })),
}));

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { invites, users } from "@/db/schema";
import { claimInvite, findRedeemableInvite } from "@/lib/oauth";

const OWNER = {
  id: randomUUID(),
  email: "owner@test.dev",
  name: "Owner",
  role: "admin" as const,
};
const CLAIMANT = {
  id: randomUUID(),
  email: "claimant@test.dev",
  name: "Claimant",
  role: "member" as const,
};

function makeInvite(overrides: Partial<typeof invites.$inferInsert> = {}) {
  return {
    code: `CODE-${randomUUID().slice(0, 8)}`,
    createdBy: OWNER.id,
    ...overrides,
  };
}

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE album_photos, albums, photos, invites, users RESTART IDENTITY CASCADE`,
  );
  await db.insert(users).values([OWNER, CLAIMANT]);
});

describe("findRedeemableInvite", () => {
  it("returns an unclaimed, unexpired invite", async () => {
    const [inv] = await db.insert(invites).values(makeInvite()).returning();

    const found = await findRedeemableInvite(inv.code);

    expect(found?.id).toBe(inv.id);
  });

  it("returns null for an unknown code", async () => {
    expect(await findRedeemableInvite("NOPE-1234")).toBeUndefined();
  });

  it("returns null for an empty code", async () => {
    expect(await findRedeemableInvite("")).toBeNull();
  });

  it("rejects an already-claimed invite", async () => {
    const [inv] = await db
      .insert(invites)
      .values(
        makeInvite({ claimedBy: CLAIMANT.id, claimedAt: new Date() }),
      )
      .returning();

    expect(await findRedeemableInvite(inv.code)).toBeUndefined();
  });

  it("rejects an expired invite", async () => {
    const [inv] = await db
      .insert(invites)
      .values(makeInvite({ expiresAt: new Date(Date.now() - 60_000) }))
      .returning();

    expect(await findRedeemableInvite(inv.code)).toBeUndefined();
  });

  it("accepts an invite whose expiry is still in the future", async () => {
    const [inv] = await db
      .insert(invites)
      .values(makeInvite({ expiresAt: new Date(Date.now() + 60_000) }))
      .returning();

    expect(await findRedeemableInvite(inv.code)).not.toBeNull();
  });
});

describe("claimInvite", () => {
  it("claims an unclaimed invite and records who and when", async () => {
    const [inv] = await db.insert(invites).values(makeInvite()).returning();

    const won = await claimInvite(inv.id, CLAIMANT.id);

    expect(won).toBe(true);
    const row = await db.query.invites.findFirst({
      where: (t, { eq }) => eq(t.id, inv.id),
    });
    expect(row?.claimedBy).toBe(CLAIMANT.id);
    expect(row?.claimedAt).toBeInstanceOf(Date);
  });

  it("loses the race when the invite is already claimed", async () => {
    const [inv] = await db
      .insert(invites)
      .values(makeInvite({ claimedBy: OWNER.id, claimedAt: new Date() }))
      .returning();

    const won = await claimInvite(inv.id, CLAIMANT.id);

    expect(won).toBe(false);
    // The losing claim must not overwrite the winner.
    const row = await db.query.invites.findFirst({
      where: (t, { eq }) => eq(t.id, inv.id),
    });
    expect(row?.claimedBy).toBe(OWNER.id);
  });

  it("returns false for a non-existent invite", async () => {
    expect(await claimInvite(randomUUID(), CLAIMANT.id)).toBe(false);
  });
});
