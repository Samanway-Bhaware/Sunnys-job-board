import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../playwright.config";

/**
 * Brief Phase 6: log in once, reload without being asked again, add a role
 * (mock provider) and see its tab, apply a sponsorship filter, set a status,
 * reload and confirm it persisted. Console errors — including CSP violations —
 * fail the test.
 */

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return errors;
}

test("the whole loop, on one browser", async ({ page }) => {
  const errors = watchConsole(page);

  // 1. The gate: an unauthenticated visit lands on the password page.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/roles/i);

  // The first visit triggers a search; wait for it to finish.
  await expect(page.getByText(/^Updated /)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("tab", { name: /Communications/ })).toBeVisible();

  // 2. Reload: still signed in, no password page.
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/roles/i);
  await expect(page.getByRole("textbox", { name: "Password" })).toHaveCount(0);

  // 3. Add a role from the tab row; its tab appears and a search runs for it alone.
  await page.getByRole("button", { name: "+ Add role" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Role name").fill("Fundraising");
  await dialog.getByLabel(/Extra keywords/).fill("grants, trusts");
  await dialog.getByRole("button", { name: "Add role and search" }).click();
  await expect(page.getByRole("tab", { name: /Fundraising/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Fundraising/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(/^Updated /)).toBeVisible({ timeout: 30_000 });
  // The new role's search found fixture listings.
  await expect(page.getByRole("tab", { name: /Fundraising\s*\d+/ })).toContainText(/[1-9]/);

  // 4. A sponsorship filter, over everything.
  await page.getByRole("tab", { name: /All roles/ }).click();
  await page.getByLabel("Visa sponsorship").selectOption("offered");
  const rows = page.locator("#roles").getByRole("link", { name: /^View listing/ });
  await expect(rows).toHaveCount(2);
  await expect(page.locator("#roles")).toContainText("Royal Mile Playhouse");
  await expect(page.locator("#roles")).toContainText("Indie Games Guild");
  await expect(page.locator("#roles").getByText("Sponsorship: Not offered")).toHaveCount(0);
  await expect(page.getByText(/1 filter on/)).toBeVisible();
  // The filter is mirrored into the URL.
  await expect(page).toHaveURL(/sp=offered/);

  // The register isn't loaded in e2e, so that option is disabled with an explanation.
  await expect(page.getByLabel("Visa sponsorship").locator("option[value=offered_or_licensed]")).toHaveAttribute("disabled", "");

  // 5. Track one: set a status and add a note.
  const status = page.getByRole("combobox", { name: /Status for Marketing Manager at Royal Mile Playhouse/ });
  await status.selectOption("saved");
  await expect(status).toHaveValue("saved");
  await page.getByRole("button", { name: "Add a note" }).first().click();
  await page.getByLabel("Notes").fill("Ask about the 2-day option");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Ask about the 2-day option")).toBeVisible();

  // 6. Reload: the status, the note and the filter all persisted.
  await page.reload();
  await expect(page.getByLabel("Visa sponsorship")).toHaveValue("offered");
  await expect(page.getByRole("combobox", { name: /Status for Marketing Manager at Royal Mile Playhouse/ })).toHaveValue("saved");
  await expect(page.getByText("Ask about the 2-day option")).toBeVisible();

  // "Roles I'm tracking" shows exactly that one.
  await page.getByLabel("Visa sponsorship").selectOption("any");
  await page.getByLabel("Show").selectOption("tracking");
  await expect(page.locator("#roles").getByRole("link", { name: /^View listing/ })).toHaveCount(1);

  // 7. Settings renders, and sign-out really signs out.
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();
  await expect(page.getByText("No key — this provider is switched off").first()).toBeVisible();
  await page.getByRole("button", { name: "Sign out of this device" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);

  // No console errors anywhere along the way — a CSP violation would show up here.
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the password gate rate-limits and stays accessible", async ({ page }) => {
  await page.goto("/login");
  const password = page.getByLabel("Password");
  for (let i = 0; i < 5; i += 1) {
    await password.fill(`wrong-${i}`);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText(/isn't right/);
  }
  await password.fill("wrong-6");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText(/Too many attempts/);
});
