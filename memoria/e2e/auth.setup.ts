import { expect, test as setup, type Page } from "@playwright/test";
import { ADMIN, MEMBER, authFile, seedInvite, userExists } from "./fixtures";

/** Signs a persona in through the form and saves the session for later specs. */
async function signInAndSave(page: Page, persona: "admin" | "member") {
  const { email, password } = persona === "admin" ? ADMIN : MEMBER;
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Memoria." })).toBeVisible();
  await page.context().storageState({ path: authFile(persona) });
}

/**
 * Registers the very first account, which the app promotes to admin with no
 * invite code, then saves the authenticated storage state for every dependent
 * spec. Idempotent: if the account already exists (re-run against the same
 * disposable DB), it just signs in again to refresh the saved session.
 */
setup("register the bootstrap admin", async ({ page }) => {
  if (await userExists(ADMIN.email)) {
    await signInAndSave(page, "admin");
    return;
  }

  await page.goto("/register");

  await page.getByLabel("Your name").fill(ADMIN.name);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Create account" }).click();

  // Successful registration signs in and lands on the gallery.
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Memoria." })).toBeVisible();

  await page.context().storageState({ path: authFile("admin") });
});

/**
 * Registers the member persona through the real invite flow: a code is seeded
 * straight into the database, then redeemed via the register form. Idempotent —
 * re-runs sign in instead of tripping the duplicate-email guard.
 */
setup("register the member via invite", async ({ page }) => {
  if (await userExists(MEMBER.email)) {
    await signInAndSave(page, "member");
    return;
  }

  const code = await seedInvite("member bootstrap");

  await page.goto("/register");
  await page.getByLabel("Invite code").fill(code);
  await page.getByLabel("Your name").fill(MEMBER.name);
  await page.getByLabel("Email").fill(MEMBER.email);
  await page.getByLabel("Password").fill(MEMBER.password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Memoria." })).toBeVisible();

  await page.context().storageState({ path: authFile("member") });
});
