import { expect, test, type Page } from "@playwright/test";
import { fixtureImage, resetData, seedAlbum, seedPhoto } from "./fixtures";

/**
 * Runs in the `member` project (storageState: member.json). Verifies the
 * signed-in experience for a non-admin family member: what they can see and
 * do, and critically what they cannot — admin routes and actions must be
 * unreachable or rejected.
 */

test.beforeEach(async () => {
  await resetData();
});

async function uploadOne(page: Page, name: "plain.png" | "rotated.jpg") {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose photos" }).click();
  await (await chooser).setFiles(fixtureImage(name));
  await expect(page.getByRole("status")).toContainText("Added 1");
}

test.describe("member navigation", () => {
  test("sees Settings but not the admin-only Family nav link", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Photos" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Albums" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Family" }),
    ).not.toBeVisible();
  });

  test("can open Settings and edit their profile name", async ({ page }) => {
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "Settings" }),
    ).toBeVisible();

    await page.getByLabel("Your name").fill("Renamed Member");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByText("Name updated.")).toBeVisible();
  });

  test("is redirected away from /settings/family", async ({ page }) => {
    // requireAdmin redirects non-admins to the vault root.
    await page.goto("/settings/family");
    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "All photos" }),
    ).toBeVisible();
  });
});

test.describe("member photo actions", () => {
  test.beforeEach(async () => {
    // The photo belongs to the admin persona, seeded straight into the DB —
    // so every assertion below is about a resource the member does not own.
    await seedPhoto("admin-photo.jpg");
  });

  test("can favourite a photo they did not upload", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("img", { name: "admin-photo.jpg" }).first().click();
    const fav = page.getByRole("button", { name: "Add to favourites" });
    await fav.click();
    await expect(
      page.getByRole("button", { name: "Favourite", pressed: true }),
    ).toBeVisible();
  });

  test("can edit a caption on a photo they did not upload", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("img", { name: "admin-photo.jpg" }).first().click();
    await page.getByLabel("Caption").fill("Lovely memory");
    await page.getByRole("button", { name: "Save caption" }).click();
    await expect(
      page.getByRole("heading", { name: "Lovely memory" }),
    ).toBeVisible();
  });

  test("does not see a Delete button on a photo they did not upload", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("img", { name: "admin-photo.jpg" }).first().click();
    // The admin persona owns this photo; the member therefore must not see
    // the destructive action.
    await expect(
      page.getByRole("button", { name: "Delete", exact: true }),
    ).not.toBeVisible();
  });

  test("sees the uploader's name on someone else's photo", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("img", { name: "admin-photo.jpg" }).first().click();
    await expect(page.getByText("Uploaded by E2E Admin")).toBeVisible();
  });
});

test.describe("member album actions", () => {
  test("can create an album", async ({ page }) => {
    await page.goto("/albums");
    await page.getByPlaceholder("Album name").fill("Member's Album");
    await page.getByRole("button", { name: "Create album" }).click();
    await expect(page).toHaveURL(/\/albums\//);
    await expect(
      page.getByRole("heading", { name: "Member's Album" }),
    ).toBeVisible();
  });

  test("can add a photo to an album via the picker", async ({ page }) => {
    await uploadOne(page, "rotated.jpg");
    await page.goto("/albums");
    await page.getByPlaceholder("Album name").fill("Member Picks");
    await page.getByRole("button", { name: "Create album" }).click();

    await page.goto("/");
    await page.getByRole("img", { name: "rotated.jpg" }).first().click();
    const checkbox = page.getByRole("checkbox", { name: "Member Picks" });
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: "Member Picks" }),
    ).toBeChecked();
  });

  test("does not see Delete on an album created by someone else", async ({
    page,
  }) => {
    // The album belongs to the admin persona.
    await seedAlbum("Admin Album");

    await page.goto("/albums");
    await page.getByRole("link", { name: /Admin Album/ }).click();
    await expect(
      page.getByRole("heading", { name: "Admin Album" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete album" }),
    ).not.toBeVisible();
  });

  test("can delete their own album", async ({ page }) => {
    await page.goto("/albums");
    await page.getByPlaceholder("Album name").fill("My Doomed Album");
    await page.getByRole("button", { name: "Create album" }).click();
    await expect(page).toHaveURL(/\/albums\//);

    await page.getByRole("button", { name: "Delete album" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL("/albums");
    await expect(
      page.getByRole("heading", { name: "No albums yet" }),
    ).toBeVisible();
  });
});
