import { expect, test, type Page } from "@playwright/test";
import { fixtureImage, resetData } from "./fixtures";

/**
 * Runs in the `admin` project (default persona). Covers the full photo
 * lifecycle against the real ingest pipeline: upload through /api/upload,
 * dedupe by checksum, the detail page's actions, and deletion.
 */

test.beforeEach(async () => {
  await resetData();
});

/** Uploads files through the uploader's hidden input and waits for the summary. */
async function uploadFiles(page: Page, ...paths: string[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose photos" }).click();
  await (await chooser).setFiles(paths);
  // The uploader renders a role=status summary once the POST resolves.
  await expect(page.getByRole("status")).toBeVisible();
}

test.describe("upload", () => {
  test("shows the empty state before any photos exist", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "The vault is empty" }),
    ).toBeVisible();
    await expect(page.getByText(/0 photos ·/)).toBeVisible();
  });

  test("uploads a JPEG and shows it in the gallery", async ({ page }) => {
    await page.goto("/");
    await uploadFiles(page, fixtureImage("plain.png"));

    await expect(page.getByRole("status")).toContainText("Added 1");
    // router.refresh() re-renders the grid with the new thumbnail.
    await expect(
      page.getByRole("img", { name: "plain.png" }).first(),
    ).toBeVisible();
    await expect(page.getByText(/1 photo ·/)).toBeVisible();
  });

  test("uploads multiple files in one batch", async ({ page }) => {
    await page.goto("/");
    await uploadFiles(
      page,
      fixtureImage("plain.png"),
      fixtureImage("rotated.jpg"),
    );

    await expect(page.getByRole("status")).toContainText("Added 2");
    await expect(
      page.getByRole("img", { name: "plain.png" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "rotated.jpg" }).first(),
    ).toBeVisible();
    await expect(page.getByText(/2 photos ·/)).toBeVisible();
  });

  test("skips a byte-identical duplicate", async ({ page }) => {
    await page.goto("/");
    await uploadFiles(page, fixtureImage("plain.png"));
    await expect(page.getByRole("status")).toContainText("Added 1");

    await uploadFiles(page, fixtureImage("plain.png"));
    await expect(page.getByRole("status")).toContainText(
      "skipped 1 already in the vault",
    );
  });

  test("skips a duplicate in a mixed batch", async ({ page }) => {
    await page.goto("/");
    await uploadFiles(page, fixtureImage("plain.png"));
    await expect(page.getByRole("status")).toContainText("Added 1");

    await uploadFiles(
      page,
      fixtureImage("plain.png"),
      fixtureImage("rotated.jpg"),
    );
    await expect(page.getByRole("status")).toContainText(
      "Added 1 · skipped 1 already in the vault",
    );
    await expect(page.getByText(/2 photos ·/)).toBeVisible();
  });

  test("rejects a non-image file with an unsupported type error", async ({
    page,
  }) => {
    await page.goto("/");
    // Create a tiny text file on the fly; the input accept is image/* but the
    // server must still guard the type.
    const buffer = Buffer.from("hello world", "utf8");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose photos" }).click();
    await (await chooser).setFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer,
    });

    await expect(page.getByRole("status")).toContainText("1 failed");
    await expect(page.getByText(/notes\.txt:/)).toBeVisible();
    await expect(page.getByText(/Unsupported file type/)).toBeVisible();
  });

  test("reports a corrupt file as failed without adding it", async ({
    page,
  }) => {
    await page.goto("/");
    await uploadFiles(page, fixtureImage("corrupt.jpg"));

    await expect(page.getByRole("status")).toContainText("1 failed");
    await expect(page.getByText(/corrupt\.jpg:/)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "The vault is empty" }),
    ).toBeVisible();
  });
});

test.describe("photo detail", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await uploadFiles(page, fixtureImage("rotated.jpg"));
    await expect(page.getByRole("status")).toContainText("Added 1");
    await page.getByRole("img", { name: "rotated.jpg" }).first().click();
    await expect(page).toHaveURL(/\/photos\//);
  });

  test("shows metadata and the uploader's name", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "rotated.jpg" }),
    ).toBeVisible();
    await expect(page.getByText("Uploaded by E2E Admin")).toBeVisible();
    await expect(page.getByText("image/jpeg")).toBeVisible();
    // rotated.jpg carries EXIF orientation ≥5, so dims are swapped by ingest.
    await expect(page.getByText(/\d+ × \d+/)).toBeVisible();
  });

  test("streams the original through the authenticated route", async ({
    page,
  }) => {
    const img = page.locator("img[src$='/orig']");
    await expect(img).toBeVisible();
    // A broken stream would leave naturalWidth at 0.
    await expect(async () => {
      const width = await img.evaluate(
        (el: HTMLImageElement) => el.naturalWidth,
      );
      expect(width).toBeGreaterThan(0);
    }).toPass();
  });

  test("edits the caption", async ({ page }) => {
    await page.getByLabel("Caption").fill("Grandma's 70th birthday");
    await page.getByRole("button", { name: "Save caption" }).click();

    await expect(
      page.getByRole("heading", { name: "Grandma's 70th birthday" }),
    ).toBeVisible();

    // Reload to prove it persisted, not just optimistic UI.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Grandma's 70th birthday" }),
    ).toBeVisible();
  });

  test("clears the caption by saving an empty value", async ({ page }) => {
    await page.getByLabel("Caption").fill("Temporary caption");
    await page.getByRole("button", { name: "Save caption" }).click();
    await expect(
      page.getByRole("heading", { name: "Temporary caption" }),
    ).toBeVisible();

    await page.getByLabel("Caption").fill("");
    await page.getByRole("button", { name: "Save caption" }).click();
    // Falls back to the original filename when caption is null.
    await expect(
      page.getByRole("heading", { name: "rotated.jpg" }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "rotated.jpg" }),
    ).toBeVisible();
  });

  test("trims whitespace from the caption", async ({ page }) => {
    await page.getByLabel("Caption").fill("  Hello world  ");
    await page.getByRole("button", { name: "Save caption" }).click();
    await expect(
      page.getByRole("heading", { name: "Hello world" }),
    ).toBeVisible();
  });

  test("toggles favourite on and off", async ({ page }) => {
    const fav = page.getByRole("button", { name: "Add to favourites" });
    await fav.click();
    await expect(
      page.getByRole("button", { name: "Favourite", pressed: true }),
    ).toBeVisible();

    // The grid shows the star for favourited photos.
    await page.goto("/");
    await expect(page.getByLabel("Favourite")).toBeVisible();

    // Toggle back off from the detail page.
    await page.getByRole("img", { name: "rotated.jpg" }).first().click();
    await page.getByRole("button", { name: "Favourite" }).click();
    await expect(
      page.getByRole("button", { name: "Add to favourites", pressed: false }),
    ).toBeVisible();
  });

  test("deletes the photo behind a confirm step", async ({ page }) => {
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Really delete" }).click();

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "The vault is empty" }),
    ).toBeVisible();
  });

  test("cancel backs out of the delete confirm", async ({ page }) => {
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByRole("button", { name: "Delete", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/photos\//);
  });

  test("downloads the original file", async ({ page }) => {
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download original" }).click();
    expect((await download).suggestedFilename()).toBe("rotated.jpg");
  });
});

test.describe("unknown photo", () => {
  test("renders 404 for a photo id that does not exist", async ({ page }) => {
    const res = await page.goto(
      "/photos/00000000-0000-0000-0000-000000000000",
    );
    expect(res?.status()).toBe(404);
  });
});
