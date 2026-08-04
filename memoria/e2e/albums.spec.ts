import { expect, test, type Page } from "@playwright/test";
import { fixtureImage, resetData } from "./fixtures";

/**
 * Album lifecycle, run as the admin persona: create via the form, add a photo
 * from the photo page (AlbumPicker), cover assignment, and deletion keeping
 * the photos themselves.
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

test.describe("albums", () => {
  test("shows the empty state before any album exists", async ({ page }) => {
    await page.goto("/albums");
    await expect(
      page.getByRole("heading", { name: "No albums yet" }),
    ).toBeVisible();
  });

  test("creates an album and lands on its page", async ({ page }) => {
    await page.goto("/albums");
    await page.getByPlaceholder("Album name").fill("Summer 2024");
    await page
      .getByPlaceholder("Description (optional)")
      .fill("The lake house trip");
    await page.getByRole("button", { name: "Create album" }).click();

    await expect(page).toHaveURL(/\/albums\//);
    await expect(
      page.getByRole("heading", { name: "Summer 2024" }),
    ).toBeVisible();
    await expect(page.getByText(/0 photos · The lake house trip/)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Nothing here yet" }),
    ).toBeVisible();
  });

  test("the photo page prompts to create an album when none exist", async ({
    page,
  }) => {
    await uploadOne(page, "plain.png");
    await page.getByRole("img", { name: "plain.png" }).first().click();

    await expect(page.getByText("No albums yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Create one" })).toHaveAttribute(
      "href",
      "/albums",
    );
  });

  test("adds a photo via the album picker and sets the cover", async ({
    page,
  }) => {
    await uploadOne(page, "rotated.jpg");

    await page.goto("/albums");
    await page.getByPlaceholder("Album name").fill("Summer 2024");
    await page.getByRole("button", { name: "Create album" }).click();
    await expect(page).toHaveURL(/\/albums\//);

    // From the photo page, tick the album.
    await page.goto("/");
    await page.getByRole("img", { name: "rotated.jpg" }).first().click();
    const checkbox = page.getByRole("checkbox", { name: "Summer 2024" });
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    // Wait for the server action to commit before leaving the page — the
    // optimistic checkbox flips instantly, but cover assignment lags.
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: "Summer 2024" }),
    ).toBeChecked();

    // The album now lists the photo...
    await page.goto("/albums");
    const card = page.getByRole("link", { name: /Summer 2024/ });
    await expect(card.getByText("1 photo")).toBeVisible();
    // ...and its cover is the photo's thumbnail.
    await expect(card.locator("img")).toBeVisible();

    await card.click();
    await expect(
      page.getByRole("img", { name: "rotated.jpg" }).first(),
    ).toBeVisible();
  });

  test("removes a photo from an album by unticking it", async ({ page }) => {
    await uploadOne(page, "rotated.jpg");
    await page.goto("/albums");
    await page.getByPlaceholder("Album name").fill("Temporary");
    await page.getByRole("button", { name: "Create album" }).click();

    await page.goto("/");
    await page.getByRole("img", { name: "rotated.jpg" }).first().click();
    const checkbox = page.getByRole("checkbox", { name: "Temporary" });
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: "Temporary" }),
    ).toBeChecked();

    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: "Temporary" }),
    ).not.toBeChecked();

    await page.goto("/albums");
    await expect(
      page.getByRole("link", { name: /Temporary/ }).getByText("0 photos"),
    ).toBeVisible();
  });

  test("deletes an album but keeps its photos", async ({ page }) => {
    await uploadOne(page, "rotated.jpg");
    await page.goto("/albums");
    await page.getByPlaceholder("Album name").fill("Doomed");
    await page.getByRole("button", { name: "Create album" }).click();

    await page.goto("/");
    await page.getByRole("img", { name: "rotated.jpg" }).first().click();
    await page.getByRole("checkbox", { name: "Doomed" }).check();
    // Let the membership action commit before navigating away.
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Doomed" })).toBeChecked();

    await page.goto("/albums");
    await page.getByRole("link", { name: /Doomed/ }).click();
    await page.getByRole("button", { name: "Delete album" }).click();
    await expect(page.getByText("Photos are kept.")).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(page).toHaveURL("/albums");
    await expect(
      page.getByRole("heading", { name: "No albums yet" }),
    ).toBeVisible();

    // The photo itself survived.
    await page.goto("/");
    await expect(
      page.getByRole("img", { name: "rotated.jpg" }).first(),
    ).toBeVisible();
  });

  test("trims whitespace from the album name", async ({ page }) => {
    await page.goto("/albums");
    await page.getByPlaceholder("Album name").fill("  Trimmed Album  ");
    await page.getByRole("button", { name: "Create album" }).click();
    await expect(page.getByRole("heading", { name: "Trimmed Album" })).toBeVisible();
  });

  test("does not create an album with only whitespace in the name", async ({
    page,
  }) => {
    await page.goto("/albums");
    await page.getByPlaceholder("Album name").fill("   ");
    await page.getByRole("button", { name: "Create album" }).click();
    // The server action returns early; the list stays empty.
    await expect(
      page.getByRole("heading", { name: "No albums yet" }),
    ).toBeVisible();
  });

  test("allows two albums with the same name", async ({ page }) => {
    await page.goto("/albums");
    await page.getByPlaceholder("Album name").fill("Duplicates");
    await page.getByRole("button", { name: "Create album" }).click();
    await expect(page.getByRole("heading", { name: "Duplicates" })).toBeVisible();

    await page.goto("/albums");
    await page.getByPlaceholder("Album name").fill("Duplicates");
    await page.getByRole("button", { name: "Create album" }).click();
    await expect(page.getByRole("heading", { name: "Duplicates" })).toBeVisible();

    // Both appear in the list.
    await page.goto("/albums");
    const cards = page.getByRole("link", { name: /Duplicates/ });
    await expect(cards).toHaveCount(2);
  });

  test("renders 404 for an album that does not exist", async ({ page }) => {
    const res = await page.goto(
      "/albums/00000000-0000-0000-0000-000000000000",
    );
    expect(res?.status()).toBe(404);
  });
});
