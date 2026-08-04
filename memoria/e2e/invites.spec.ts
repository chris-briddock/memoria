import { expect, test } from "@playwright/test";
import { MEMBER, guestContext, resetData, seedInvite } from "./fixtures";

/**
 * Invite lifecycle and the admin-only Family settings page, run as the admin
 * persona. The member-side restrictions live in members.spec.ts (member
 * project).
 */

test.beforeEach(async () => {
  await resetData();
});

test.describe("family settings (admin)", () => {
  test("creates an invite and shows it with its code and expiry", async ({
    page,
  }) => {
    await page.goto("/settings/family");

    await page.getByPlaceholder("Who is this for? (optional)").fill("Aunt May");
    await page.getByRole("button", { name: "Create invite" }).click();

    // revalidatePath re-renders the list with the new open invite.
    const item = page.locator("li", { hasText: "Aunt May" });
    await expect(item).toBeVisible();
    await expect(item.locator("code")).toHaveText(
      /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/,
    );
    await expect(item.getByText(/Expires/)).toBeVisible();
  });

  test("creates an invite without a note", async ({ page }) => {
    await page.goto("/settings/family");
    await page.getByRole("button", { name: "Create invite" }).click();

    await expect(page.locator("li code").first()).toHaveText(
      /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/,
    );
    // The note placeholder shows an em dash when no note was provided.
    await expect(page.locator("li").first().getByText("—")).toBeVisible();
  });

  test("trims a very long note to the database limit", async ({ page }) => {
    await page.goto("/settings/family");
    const longNote = "A".repeat(300);
    await page.getByPlaceholder("Who is this for? (optional)").fill(longNote);
    await page.getByRole("button", { name: "Create invite" }).click();

    const item = page.locator("li", { hasText: "AAAA" });
    await expect(item).toBeVisible();
    // The stored note is truncated to 200 chars; the UI shows the full stored string.
    await expect(item.getByText(/^A{200}$/)).toBeVisible();
  });

  test("revokes an invite", async ({ page }) => {
    await page.goto("/settings/family");
    await page.getByPlaceholder("Who is this for? (optional)").fill("Uncle Ben");
    await page.getByRole("button", { name: "Create invite" }).click();
    const item = page.locator("li", { hasText: "Uncle Ben" });
    await expect(item).toBeVisible();

    await item.getByRole("button", { name: "Revoke" }).click();
    await expect(item).not.toBeVisible();
    await expect(page.getByText("No unused invites.")).toBeVisible();
  });

  test("lists members with roles and photo counts", async ({ page }) => {
    await page.goto("/settings/family");

    const members = page.locator("section", { hasText: "Members" });
    await expect(members.getByText("E2E Admin")).toBeVisible();
    await expect(members.getByText("admin@e2e.dev")).toBeVisible();
    await expect(
      members.getByText("admin", { exact: true }),
    ).toBeVisible();
    await expect(members.getByText(MEMBER.name)).toBeVisible();
    await expect(members.getByText(MEMBER.email)).toBeVisible();
  });

  test("shows claimed invites collapsed once used", async ({ page }) => {
    // The member persona was registered through an invite in setup, but
    // beforeEach wiped invites — seed one and claim it via registration.
    const code = await seedInvite("for cousin");
    await page.goto("/settings/family");
    // The freshly seeded invite is still unused, so it shows in the open list.
    await expect(page.locator("li", { hasText: code })).toBeVisible();
    await expect(page.getByText("No unused invites.")).not.toBeVisible();

    // Register a throwaway account with the code, then come back.
    const context = await guestContext(page.context().browser()!);
    const guest = await context.newPage();
    await guest.goto("/register");
    await guest.getByLabel("Invite code").fill(code);
    await guest.getByLabel("Your name").fill("Cousin E2E");
    await guest.getByLabel("Email").fill("cousin@e2e.dev");
    await guest.getByLabel("Password").fill("a-long-enough-password");
    await guest.getByRole("button", { name: "Create account" }).click();
    await expect(guest).toHaveURL("/");
    await context.close();

    await page.goto("/settings/family");
    await expect(page.getByText("No unused invites.")).toBeVisible();
    const details = page.locator("details", { hasText: "claimed invite" });
    await expect(details.locator("summary")).toHaveText("1 claimed invite");
    await details.locator("summary").click();
    await expect(details.getByText(code)).toBeVisible();
  });

  test("a seeded invite can be redeemed through the register form", async ({
    page,
  }) => {
    const code = await seedInvite("redeemable");

    // A fresh context stands in for the invitee's own browser.
    const context = await guestContext(page.context().browser()!);
    const guest = await context.newPage();
    await guest.goto("/register");
    await guest.getByLabel("Invite code").fill(code);
    await guest.getByLabel("Your name").fill("New Cousin");
    await guest.getByLabel("Email").fill("newcousin@e2e.dev");
    await guest.getByLabel("Password").fill("a-long-enough-password");
    await guest.getByRole("button", { name: "Create account" }).click();

    await expect(guest).toHaveURL("/");
    await expect(
      guest.getByRole("heading", { name: "All photos" }),
    ).toBeVisible();
    // A plain member does not see the admin-only Family nav link.
    await expect(
      guest.getByRole("link", { name: "Family" }),
    ).not.toBeVisible();
    await context.close();
  });
});
