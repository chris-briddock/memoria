import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/dal";

// ---- Mocks ----------------------------------------------------------------

const { verifySession, revalidatePath, redirect, deleteObjects } = vi.hoisted(
  () => ({
    verifySession: vi.fn<() => Promise<SessionUser>>(),
    revalidatePath: vi.fn(),
    redirect: vi.fn(),
    deleteObjects: vi.fn<(keys: string[]) => Promise<void>>(),
  }),
);

vi.mock("@/lib/dal", () => ({ verifySession }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/storage", () => ({ deleteObjects }));

// Chainable Drizzle query-builder mock. Every method returns `chain` so calls
// compose; `await chain` resolves `chain.result`. `db.query.<table>.findFirst`
// resolves `findFirstResults[table]`.
const findFirstResults: Record<string, unknown> = {};
let insertCaptures: unknown[] = [];

function makeChain(result: unknown) {
  const chain: Record<string, unknown> & { result: unknown } = { result };
  for (const m of [
    "set",
    "where",
    "values",
    "onConflictDoNothing",
    "returning",
  ]) {
    chain[m] = vi.fn(() => chain);
  }
  // Capture inserted values for assertions.
  (chain.values as ReturnType<typeof vi.fn>).mockImplementation((v: unknown) => {
    insertCaptures.push(v);
    return chain;
  });
  chain.then = (
    onFulfilled?: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

const chains: ReturnType<typeof makeChain>[] = [];
let findFirstQueue: unknown[] = [];

vi.mock("@/db", () => {
  const db = {
    update: vi.fn(() => {
      const c = makeChain(undefined);
      chains.push(c);
      return c;
    }),
    insert: vi.fn(() => {
      const c = makeChain(undefined);
      chains.push(c);
      return c;
    }),
    delete: vi.fn(() => {
      const c = makeChain(undefined);
      chains.push(c);
      return c;
    }),
    query: {
      photos: { findFirst: vi.fn(() => Promise.resolve(findFirstQueue.shift())) },
      albums: { findFirst: vi.fn(() => Promise.resolve(findFirstQueue.shift())) },
    },
  };
  return { db };
});

import {
  createAlbum,
  createInvite,
  deleteAlbum,
  deletePhoto,
  revokeInvite,
  setPhotoAlbum,
  toggleFavorite,
  updateCaption,
} from "@/lib/actions/photos";

// ---- Fixtures -------------------------------------------------------------

const ADMIN: SessionUser = {
  id: "admin-id",
  email: "admin@example.com",
  name: "Admin",
  role: "admin",
};
const MEMBER: SessionUser = {
  id: "member-id",
  email: "member@example.com",
  name: "Member",
  role: "member",
};

const PID = "3f6d3c94-1b7c-4e2d-9a8f-0c1b2d3e4f5a";
const AID = "1a2b3c4d-5e6f-47a8-b9c0-d1e2f3a4b5c6";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  chains.length = 0;
  findFirstQueue = [];
  insertCaptures = [];
  for (const k of Object.keys(findFirstResults)) delete findFirstResults[k];
});

// ---- toggleFavorite --------------------------------------------------------

describe("toggleFavorite", () => {
  it("flips an existing photo's favorite flag and revalidates", async () => {
    verifySession.mockResolvedValue(MEMBER);
    findFirstQueue = [{ id: PID, favorite: false }];

    await toggleFavorite(PID);

    expect(chains).toHaveLength(1);
    expect(chains[0].set).toHaveBeenCalledWith({ favorite: true });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith(`/photos/${PID}`);
  });

  it("does nothing when the photo does not exist", async () => {
    verifySession.mockResolvedValue(MEMBER);
    findFirstQueue = [undefined];

    await toggleFavorite(PID);

    expect(chains).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an invalid photo id", async () => {
    verifySession.mockResolvedValue(MEMBER);
    await expect(toggleFavorite("not-a-uuid")).rejects.toThrow();
  });
});

// ---- updateCaption ---------------------------------------------------------

describe("updateCaption", () => {
  it("trims and stores a caption", async () => {
    verifySession.mockResolvedValue(MEMBER);
    await updateCaption(PID, fd({ caption: "  Summer 2025  " }));
    expect(chains[0].set).toHaveBeenCalledWith({ caption: "Summer 2025" });
    expect(revalidatePath).toHaveBeenCalledWith(`/photos/${PID}`);
  });

  it("stores null when the caption is empty after trimming", async () => {
    verifySession.mockResolvedValue(MEMBER);
    await updateCaption(PID, fd({ caption: "   " }));
    expect(chains[0].set).toHaveBeenCalledWith({ caption: null });
  });

  it("truncates captions to 500 characters", async () => {
    verifySession.mockResolvedValue(MEMBER);
    const long = "x".repeat(600);
    await updateCaption(PID, fd({ caption: long }));
    expect(chains[0].set).toHaveBeenCalledWith({ caption: "x".repeat(500) });
  });
});

// ---- deletePhoto -----------------------------------------------------------

describe("deletePhoto", () => {
  const photo = {
    id: PID,
    uploadedBy: MEMBER.id,
    storageKey: "ab/cd/orig.jpg",
    thumbKey: "ab/cd/thumb.webp",
  };

  it("lets the uploader delete their own photo and its objects", async () => {
    verifySession.mockResolvedValue(MEMBER);
    findFirstQueue = [photo];

    await deletePhoto(PID);

    expect(chains).toHaveLength(1); // the delete
    expect(deleteObjects).toHaveBeenCalledWith([photo.storageKey, photo.thumbKey]);
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("lets an admin delete someone else's photo", async () => {
    verifySession.mockResolvedValue(ADMIN);
    findFirstQueue = [photo];

    await deletePhoto(PID);

    expect(deleteObjects).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("forbids a member deleting another member's photo", async () => {
    verifySession.mockResolvedValue({
      ...MEMBER,
      id: "someone-else",
    });
    findFirstQueue = [photo];

    await expect(deletePhoto(PID)).rejects.toThrow(
      "You can only delete photos you uploaded.",
    );
    expect(deleteObjects).not.toHaveBeenCalled();
  });

  it("does nothing when the photo does not exist", async () => {
    verifySession.mockResolvedValue(MEMBER);
    findFirstQueue = [undefined];

    await deletePhoto(PID);

    expect(chains).toHaveLength(0);
    expect(deleteObjects).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

// ---- createAlbum -----------------------------------------------------------

describe("createAlbum", () => {
  it("creates an album and redirects to it", async () => {
    verifySession.mockResolvedValue(MEMBER);
    // insert().returning() resolves with [{ id }]
    const insertChain = makeChain([{ id: AID }]);
    chains.push(insertChain);
    const { db } = await import("@/db");
    (db.insert as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      (insertChain.values as ReturnType<typeof vi.fn>).mockImplementation(
        (v: unknown) => {
          insertCaptures.push(v);
          return insertChain;
        },
      );
      return insertChain;
    });

    await createAlbum(fd({ name: "Holidays", description: "  Family trips " }));

    expect(insertCaptures[0]).toEqual({
      name: "Holidays",
      description: "Family trips",
      createdBy: MEMBER.id,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/albums");
    expect(redirect).toHaveBeenCalledWith(`/albums/${AID}`);
  });

  it("does nothing when the name is blank", async () => {
    verifySession.mockResolvedValue(MEMBER);
    await createAlbum(fd({ name: "   " }));
    expect(chains).toHaveLength(0);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("stores null description when none is given", async () => {
    verifySession.mockResolvedValue(MEMBER);
    const insertChain = makeChain([{ id: AID }]);
    const { db } = await import("@/db");
    (db.insert as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      (insertChain.values as ReturnType<typeof vi.fn>).mockImplementation(
        (v: unknown) => {
          insertCaptures.push(v);
          return insertChain;
        },
      );
      return insertChain;
    });

    await createAlbum(fd({ name: "Solo" }));

    expect(insertCaptures[0]).toMatchObject({ description: null });
  });
});

// ---- setPhotoAlbum ---------------------------------------------------------

describe("setPhotoAlbum", () => {
  it("adds a photo to an album and sets a cover when the album has none", async () => {
    verifySession.mockResolvedValue(MEMBER);

    await setPhotoAlbum(PID, AID, true);

    // insert + update
    expect(chains).toHaveLength(2);
    expect(insertCaptures[0]).toEqual({ albumId: AID, photoId: PID });
    expect(chains[1].set).toHaveBeenCalledWith({ coverPhotoId: PID });
    expect(revalidatePath).toHaveBeenCalledWith(`/albums/${AID}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/photos/${PID}`);
    expect(revalidatePath).toHaveBeenCalledWith("/albums");
  });

  it("removes a photo from an album", async () => {
    verifySession.mockResolvedValue(MEMBER);

    await setPhotoAlbum(PID, AID, false);

    expect(chains).toHaveLength(1); // delete only
    expect(revalidatePath).toHaveBeenCalledWith(`/albums/${AID}`);
  });
});

// ---- deleteAlbum -----------------------------------------------------------

describe("deleteAlbum", () => {
  const album = { id: AID, createdBy: MEMBER.id };

  it("lets the creator delete their album", async () => {
    verifySession.mockResolvedValue(MEMBER);
    findFirstQueue = [album];

    await deleteAlbum(AID);

    expect(chains).toHaveLength(1);
    expect(revalidatePath).toHaveBeenCalledWith("/albums");
    expect(redirect).toHaveBeenCalledWith("/albums");
  });

  it("lets an admin delete someone else's album", async () => {
    verifySession.mockResolvedValue(ADMIN);
    findFirstQueue = [album];

    await deleteAlbum(AID);

    expect(redirect).toHaveBeenCalledWith("/albums");
  });

  it("forbids a member deleting another's album", async () => {
    verifySession.mockResolvedValue({ ...MEMBER, id: "intruder" });
    findFirstQueue = [album];

    await expect(deleteAlbum(AID)).rejects.toThrow(
      "You can only delete albums you created.",
    );
    expect(chains).toHaveLength(0);
  });

  it("does nothing when the album does not exist", async () => {
    verifySession.mockResolvedValue(MEMBER);
    findFirstQueue = [undefined];

    await deleteAlbum(AID);

    expect(chains).toHaveLength(0);
    expect(redirect).not.toHaveBeenCalled();
  });
});

// ---- createInvite ----------------------------------------------------------

describe("createInvite", () => {
  it("generates a grouped, ambiguity-free invite code for admins", async () => {
    verifySession.mockResolvedValue(ADMIN);

    await createInvite(fd({ note: "For the cousins" }));

    const values = insertCaptures[0] as {
      code: string;
      note: string | null;
      createdBy: string;
      expiresAt: Date;
    };
    // 12 chars grouped as XXXX-XXXX-XXXX from the unambiguous alphabet.
    expect(values.code).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){2}$/);
    expect(values.code).not.toMatch(/[OI01]/);
    expect(values.note).toBe("For the cousins");
    expect(values.createdBy).toBe(ADMIN.id);
    // ~30 days out.
    const days =
      (values.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/family");
  });

  it("stores null note when none given", async () => {
    verifySession.mockResolvedValue(ADMIN);
    await createInvite(fd({}));
    expect((insertCaptures[0] as { note: string | null }).note).toBeNull();
  });

  it("rejects non-admins", async () => {
    verifySession.mockResolvedValue(MEMBER);
    await expect(createInvite(fd({}))).rejects.toThrow(
      "Only an admin can create invites.",
    );
    expect(insertCaptures).toHaveLength(0);
  });
});

// ---- revokeInvite ----------------------------------------------------------

describe("revokeInvite", () => {
  it("lets an admin revoke an invite", async () => {
    verifySession.mockResolvedValue(ADMIN);
    await revokeInvite(AID);
    expect(chains).toHaveLength(1);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/family");
  });

  it("rejects non-admins", async () => {
    verifySession.mockResolvedValue(MEMBER);
    await expect(revokeInvite(AID)).rejects.toThrow(
      "Only an admin can revoke invites.",
    );
    expect(chains).toHaveLength(0);
  });
});
