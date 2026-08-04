import { expect, test } from "@playwright/test";
import { ADMIN, resetData, seedInvite } from "./fixtures";

/**
 * Runs in the `anonymous` project: an empty storage state, so these specs
 * exercise the signed-out experience and the proxy's guard redirects.
 * The shared DB is untouched except by `resetData` where a flow creates rows.
 */

test.describe("route guarding (proxy)", () => {
  test("signed-out visitors are bounced to /signin with a next param", async ({
    page,
  }) => {
    await page.goto("/albums");
    await expect(page).toHaveURL(/\/signin\?next=%2Falbums/);
  });

  test("deep links preserve their destination", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/signin\?next=%2Fsettings/);
  });

  test("signin then follows the next param back", async ({ page }) => {
    await page.goto("/albums");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/albums");
    // The session survives navigation.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "All photos" })).toBeVisible();
  });
});

test.describe("sign in", () => {
  test("rejects a wrong password with an inline error", async ({ page }) => {
    await page.goto("/signin");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.locator("p[role='alert']")).toHaveText(
      "That email and password combination isn't right.",
    );
    await expect(page).toHaveURL(/\/signin/);
  });

  test("rejects an unknown email", async ({ page }) => {
    await page.goto("/signin");
    await page.getByLabel("Email").fill("ghost@e2e.dev");
    await page.getByLabel("Password").fill("whatever-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.locator("p[role='alert']")).toHaveText(
      "That email and password combination isn't right.",
    );
  });

  test("signs in with valid credentials and shows the vault", async ({
    page,
  }) => {
    await page.goto("/signin");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL("/");
    await expect(page.getByRole("link", { name: "Memoria." })).toBeVisible();
    // Admin sees the Family nav item.
    await expect(page.getByRole("link", { name: "Family" })).toBeVisible();
  });
});

test.describe("a11y: auth forms", () => {
  test("sign-in form has labelled fields and a submit button", async ({
    page,
  }) => {
    await page.goto("/signin");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
  });

  test("register form has labelled fields including invite code", async ({
    page,
  }) => {
    await page.goto("/register");
    await expect(page.getByLabel("Invite code")).toBeVisible();
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create account" }),
    ).toBeVisible();
  });

  test("error messages use role=alert", async ({ page }) => {
    await page.goto("/signin");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    const alert = page.locator("p[role='alert']");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(
      "That email and password combination isn't right.",
    );
  });
});

test.describe("sign out", () => {
  test("returns to /signin and re-guards the vault", async ({ page }) => {
    await page.goto("/signin");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/signin/);

    // The session cookie is gone, so the vault is guarded again.
    await page.goto("/albums");
    await expect(page).toHaveURL(/\/signin\?next=%2Falbums/);
  });
});

test.describe("registration", () => {
  test.beforeEach(async () => {
    await resetData();
  });

  test("requires an invite code once accounts exist", async ({ page }) => {
    await page.goto("/register");
    await expect(
      page.getByText("Enter the invite code a family admin gave you."),
    ).toBeVisible();

    await page.getByLabel("Your name").fill("No Invite");
    await page.getByLabel("Email").fill("noinvite@e2e.dev");
    await page.getByLabel("Password").fill("a-long-enough-password");
    // The input is `required`, which would stop submission client-side; strip
    // it to exercise the server-side guard.
    await page.evaluate(() => {
      document.querySelector<HTMLInputElement>("#inviteCode")!.required = false;
    });
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.locator("p[role='alert']")).toHaveText(
      "An invite code is required.",
    );
  });

  test("rejects an invalid invite code", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Invite code").fill("XXXX-XXXX-XXXX");
    await page.getByLabel("Your name").fill("Bad Code");
    await page.getByLabel("Email").fill("badcode@e2e.dev");
    await page.getByLabel("Password").fill("a-long-enough-password");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.locator("p[role='alert']")).toHaveText(
      "That invite code is not valid or has been used.",
    );
  });

  test("rejects an expired invite code", async ({ page }) => {
    const code = await seedInvite("expired", "-1 day");
    await page.goto("/register");
    await page.getByLabel("Invite code").fill(code);
    await page.getByLabel("Your name").fill("Expired User");
    await page.getByLabel("Email").fill("expired@e2e.dev");
    await page.getByLabel("Password").fill("a-long-enough-password");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.locator("p[role='alert']")).toHaveText(
      "That invite code is not valid or has been used.",
    );
  });

  test("rejects a duplicate email", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Invite code").fill("XXXX-XXXX-XXXX");
    await page.getByLabel("Your name").fill("Admin Clone");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill("a-long-enough-password");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.locator("p[role='alert']")).toHaveText(
      "An account with that email already exists.",
    );
  });

  test("validates password length", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Invite code").fill("XXXX-XXXX-XXXX");
    await page.getByLabel("Your name").fill("Short Pass");
    await page.getByLabel("Email").fill("shortpass@e2e.dev");
    await page.getByLabel("Password").fill("short");
    // minLength on the input blocks submission in supporting browsers; force it
    // through to exercise the server-side schema too.
    await page.evaluate(() => {
      document.querySelector<HTMLInputElement>("#password")!.minLength = 0;
    });
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.locator("p[role='alert']")).toHaveText(
      "Use at least 10 characters",
    );
  });

  test("validates email format", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Invite code").fill("XXXX-XXXX-XXXX");
    await page.getByLabel("Your name").fill("Bad Email");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("a-long-enough-password");
    // The input is type="email", which would stop submission client-side; strip
    // it to exercise the server-side schema too.
    await page.evaluate(() => {
      document.querySelector<HTMLInputElement>("#email")!.type = "text";
    });
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.locator("p[role='alert']")).toHaveText(
      "Enter a valid email address",
    );
  });
});
