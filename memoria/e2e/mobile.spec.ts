import { expect, test } from "@playwright/test";
import { resetData } from "./fixtures";

/**
 * Responsive checks that only run under the `mobile` project (phone-sized
 * viewport, see playwright.config.ts). They pin the breakpoint behaviour of
 * the vault navigation: inline links collapse into a hamburger menu, and the
 * rendered page must fit the viewport without horizontal scrolling.
 */

test.beforeEach(async () => {
  await resetData();
});

/** Horizontal overflow is the class of bug this suite guards against. */
async function expectNoHorizontalScroll(page: import("@playwright/test").Page) {
  const width = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(width, "page should not scroll horizontally").toBeLessThanOrEqual(0);
}

test.describe("mobile navigation", () => {
  test("collapses into a labelled hamburger menu within the viewport", async ({
    page,
  }) => {
    await page.goto("/");

    // The inline desktop nav is hidden at this width; only the hamburger shows.
    await expect(page.getByRole("link", { name: "Photos" })).toBeHidden();
    await expect(page.getByRole("link", { name: "Albums" })).toBeHidden();

    const toggle = page.getByRole("button", { name: "Open menu" });
    await expect(toggle).toBeVisible();

    // Both the header and the toggle fit inside the viewport width.
    const viewport = page.viewportSize();
    const toggleBox = await toggle.boundingBox();
    expect(viewport).not.toBeNull();
    expect(toggleBox).not.toBeNull();
    expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(viewport!.width);
    await expectNoHorizontalScroll(page);
  });

  test("menu exposes the primary links, identity and sign out", async ({
    page,
  }) => {
    await page.goto("/");

    const toggle = page.getByRole("button", { name: "Open menu" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();

    await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const menuNav = page.getByRole("navigation", { name: "Primary" });
    await expect(menuNav.getByRole("link", { name: "Photos" })).toBeVisible();
    await expect(menuNav.getByRole("link", { name: "Albums" })).toBeVisible();
    await expect(menuNav.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(menuNav.getByRole("link", { name: "Family" })).toBeVisible();

    // Identity and sign out sit in the dropdown's footer, below the nav. The
    // toggle's accessible name flips to "Close menu" once open, so the
    // identity text is looked up from the page rather than via aria-controls.
    // The hidden desktop header also contains the identity in the DOM, which
    // trips strict mode on a plain text lookup; the dropdown copy is the only
    // <p> with this text.
    await expect(
      page.locator("p").filter({ hasText: "E2E Admin" }),
    ).toBeVisible();
    // Only the dropdown's Sign out is visible; the desktop header copy is
    // display:none at this breakpoint and absent from the a11y tree.
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("closes after following a menu link", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Albums" })
      .click();

    await expect(page).toHaveURL(/\/albums$/);
    await expect(page.getByRole("button", { name: "Close menu" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  });

  test("closes on Escape", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Close menu" })).toBeHidden();
  });
});

test.describe("mobile layout", () => {
  test("core pages fit the viewport without horizontal scrolling", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Choose photos" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.goto("/albums");
    await expect(page.getByPlaceholder("Album name")).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "Settings" }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
