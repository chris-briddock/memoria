import { expect, test } from "@playwright/test";
import { fixtureImage, resetData } from "./fixtures";

/**
 * Lightweight accessibility smoke checks across the core surfaces. These are
 * not a substitute for axe-core audits, but they catch missing labels, wrong
 * roles, and broken focus management before they reach users.
 */

test.beforeEach(async () => {
  await resetData();
});

test.describe("a11y: gallery", () => {
  test("has a labelled uploader and photo grid items", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Choose photos" })).toBeVisible();
    await expect(page.getByText("JPEG, PNG, WebP, AVIF, GIF, TIFF or HEIC")).toBeVisible();

    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose photos" }).click();
    await (await chooser).setFiles(fixtureImage("plain.png"));
    await expect(page.getByRole("status")).toContainText("Added 1");

    // Grid items are links with accessible names from the image alt text.
    await expect(
      page.getByRole("link", { name: /plain\.png/ }).first(),
    ).toBeVisible();
  });

  test("photo detail page has labelled form controls", async ({ page }) => {
    await page.goto("/");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose photos" }).click();
    await (await chooser).setFiles(fixtureImage("rotated.jpg"));
    await expect(page.getByRole("status")).toContainText("Added 1");
    await page.getByRole("img", { name: "rotated.jpg" }).first().click();

    await expect(page.getByLabel("Caption")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save caption" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add to favourites" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Download original" }),
    ).toBeVisible();
  });
});

test.describe("a11y: albums", () => {
  test("album form and list have correct roles", async ({ page }) => {
    await page.goto("/albums");
    await expect(page.getByPlaceholder("Album name")).toBeVisible();
    await expect(
      page.getByPlaceholder("Description (optional)"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create album" }),
    ).toBeVisible();

    await page.getByPlaceholder("Album name").fill("A11y Test");
    await page.getByRole("button", { name: "Create album" }).click();

    // createAlbum redirects to the new album's page once the action has
    // committed; waiting for it keeps the list assertion below from racing
    // the server action (a `goto` can otherwise serve a stale /albums page).
    await expect(page).toHaveURL(/\/albums\/[0-9a-f-]{36}/);
    await expect(
      page.getByRole("heading", { name: "A11y Test" }),
    ).toBeVisible();

    await page.goto("/albums");
    await expect(
      page.getByRole("link", { name: /A11y Test/ }),
    ).toBeVisible();
  });
});

test.describe("a11y: settings", () => {
  test("invite form and member list have correct structure", async ({
    page,
  }) => {
    await page.goto("/settings/family");
    await expect(
      page.getByPlaceholder("Who is this for? (optional)"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create invite" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Create invite" }).click();
    await expect(page.locator("li code").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Revoke" }),
    ).toBeVisible();
  });
});
