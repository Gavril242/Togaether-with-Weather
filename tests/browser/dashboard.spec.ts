import { expect, test, type Page } from "@playwright/test";
import { mockDashboardApi, places, seedPlaces, STORAGE_KEY } from "./fixtures";

const search = (page: Page) => page.getByRole("combobox", { name: "Find your next place" });
const card = (page: Page, name: string) => page.getByRole("article", { name: `Weather for ${name}`, exact: true });

async function choosePlace(page: Page, query: string, match: RegExp) {
  await search(page).fill(query);
  const option = page.getByRole("option").filter({ hasText: match });
  await expect(option).toHaveCount(1);
  await option.click();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("chooses an unambiguous Springfield and displays API units", async ({ page }) => {
  const api = await mockDashboardApi(page);
  await page.goto("/");
  await search(page).fill("Springfield");
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(page.getByRole("option").filter({ hasText: /Illinois/ })).toContainText("United States");
  await expect(page.getByRole("option").filter({ hasText: /Massachusetts/ })).toContainText("United States");
  await page.getByRole("option").filter({ hasText: /Massachusetts/ }).click();
  const selected = card(page, "Springfield");
  await expect(selected).toContainText("Massachusetts");
  await expect(selected).toContainText("°C");
  await expect(selected).toContainText("km/h");
  await expect(selected).toContainText("Moderate rain");
  await expect(selected).toContainText("21°C");
  await expect(selected).toContainText("26°C high");
  await expect(selected).toContainText("6°C low");
  await expect(selected).toContainText("12 km/h");
  await expect(selected.locator("time")).toHaveText("13:05");
  expect(api.requestedWeather).toContain(places.springfieldMassachusetts.id);
  expect(api.requestedWeather).not.toContain(places.springfieldIllinois.id);
  await expect(page.getByText("1 of 4 places", { exact: true })).toBeVisible();
});

test("keeps four selected places across reload and allows removal and replacement", async ({ page }, testInfo) => {
  await mockDashboardApi(page);
  await page.goto("/");
  await choosePlace(page, "Springfield", /Massachusetts/);
  await choosePlace(page, "London", /United Kingdom/);
  await choosePlace(page, "Tokyo", /Japan/);
  await choosePlace(page, "Reykjavik", /Iceland/);
  await expect(page.getByText("4 of 4 places", { exact: true })).toBeVisible();
  await expect(search(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Generate weather image", exact: true })).toBeDisabled();
  await page.reload();
  for (const name of ["Springfield", "London", "Tokyo", "Reykjavik"]) {
    await expect(card(page, name)).toBeVisible();
    await expect(card(page, name)).toContainText("Moderate rain");
  }
  // The preview caption explicitly identifies the synthetic weather fixture.
  await page.evaluate(() => {
    const caption = document.createElement("div");
    caption.dataset.fixturePreview = "true";
    caption.textContent = "Fixture preview. Weather values are deterministic test data.";
    caption.style.cssText = "position:relative;z-index:99999;margin:8px;padding:8px 12px;border-radius:6px;background:#10221f;color:white;font:12px sans-serif;text-align:center;";
    document.body.appendChild(caption);
  });
  const viewport = testInfo.project.name === "mobile" ? "mobile" : "desktop";
  await page.screenshot({ path: `.local/previews/fixture-dashboard-${viewport}.png`, fullPage: true });
  await page.locator("[data-fixture-preview]").evaluate((element) => element.remove());
  await page.getByRole("button", { name: "Remove London", exact: true }).click();
  await expect(card(page, "London")).toHaveCount(0);
  await expect(search(page)).toBeEnabled();
  await choosePlace(page, "Cape Town", /South Africa/);
  await expect(card(page, "Cape Town")).toContainText("Moderate rain");
  await expect(page.getByText("4 of 4 places", { exact: true })).toBeVisible();
  await page.reload();
  await expect(card(page, "Cape Town")).toBeVisible();
  await expect(card(page, "London")).toHaveCount(0);
});

test("rejects a duplicate and does not fill another slot", async ({ page }) => {
  await mockDashboardApi(page);
  await page.goto("/");
  await choosePlace(page, "London", /United Kingdom/);
  await choosePlace(page, "London", /United Kingdom/);
  await expect(page.getByRole("alert").filter({ hasText: "already on your dashboard" })).toBeVisible();
  await expect(card(page, "London")).toHaveCount(1);
  await expect(page.getByText("1 of 4 places", { exact: true })).toBeVisible();
});

test("one failing weather card leaves other cards usable and retry clears the error", async ({ page }) => {
  const api = await mockDashboardApi(page);
  api.failingWeather.add(places.springfieldMassachusetts.id);
  await seedPlaces(page, [places.springfieldMassachusetts, places.london, places.tokyo, places.reykjavik]);
  await page.goto("/");
  const failed = card(page, "Springfield");
  await expect(failed).toContainText("took too long to respond");
  for (const name of ["London", "Tokyo", "Reykjavik"]) {
    await expect(card(page, name)).toContainText("Moderate rain");
  }
  api.failingWeather.delete(places.springfieldMassachusetts.id);
  await failed.getByRole("button", { name: /Retry/i }).click();
  await expect(failed).toContainText("Moderate rain");
  await expect(failed.getByText(/took too long to respond/)).toHaveCount(0);
  await expect(page.getByText("4 of 4 places", { exact: true })).toBeVisible();
});

test("reports a nonexistent place and a failed search without removing existing places", async ({ page }) => {
  const api = await mockDashboardApi(page);
  await seedPlaces(page, [places.london]);
  await page.goto("/");
  await search(page).fill("NowhereTestPlace");
  await expect(page.getByText("No places found. Try another name or spelling.")).toBeVisible();
  await expect(card(page, "London")).toContainText("Moderate rain");
  api.failingSearches.add("brokenplace");
  await search(page).fill("BrokenPlace");
  await expect(page.getByRole("alert").filter({ hasText: "Place search took too long" })).toBeVisible();
  await expect(card(page, "London")).toContainText("Moderate rain");
  await choosePlace(page, "Tokyo", /Japan/);
  await expect(card(page, "Tokyo")).toContainText("Moderate rain");
});

test("clicking a weather card changes the selected local sky", async ({ page }) => {
  await mockDashboardApi(page);
  await seedPlaces(page, [places.london, places.tokyo]);
  await page.goto("/");
  const tokyo = card(page, "Tokyo");
  await expect(tokyo.getByRole("button", { name: "Focus sky for Tokyo" })).toHaveAttribute("aria-pressed", "false");
  await tokyo.getByRole("heading", { name: "Tokyo" }).click();
  await expect(tokyo.getByRole("button", { name: "In focus for Tokyo" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".hero-note")).toContainText("Tokyo");
  await expect(page.locator("[data-condition]")).toHaveAttribute("data-condition", "rain");
});

test("shows a clear retry message when a gateway returns HTML for a spaced city search", async ({ page }) => {
  await mockDashboardApi(page);
  await page.route("**/api/locations?q=New%20York", route => route.fulfill({
    status: 502,
    contentType: "text/html",
    body: "<!DOCTYPE html><title>Bad gateway</title>",
  }));
  await page.goto("/");
  await search(page).fill("New York");
  await expect(page.locator(".search-area p[role=alert]")).toContainText("Place search is temporarily unavailable. Please try again.");
  await expect(page.locator(".search-area p[role=alert]")).not.toContainText("Unexpected token");
});

test("recovers from corrupt persisted locations with a clear message", async ({ page }) => {
  await mockDashboardApi(page);
  await page.addInitScript((key) => localStorage.setItem(key, "{broken-json"), STORAGE_KEY);
  await page.goto("/");
  await expect(page.getByText("Saved places could not be restored. Please choose them again.")).toBeVisible();
  await expect(page.getByText("0 of 4 places", { exact: true })).toBeVisible();
  await choosePlace(page, "London", /United Kingdom/);
  await expect(card(page, "London")).toContainText("Moderate rain");
  await expect(page.getByText("Saved places could not be restored. Please choose them again.")).toHaveCount(0);
});

test("supports choosing a search result with the keyboard", async ({ page }) => {
  await mockDashboardApi(page);
  await page.goto("/");
  await search(page).fill("Springfield");
  await expect(page.getByRole("option")).toHaveCount(2);
  await search(page).press("ArrowDown");
  await expect(page.getByRole("option").filter({ hasText: /Illinois/ })).toHaveAttribute("aria-selected", "true");
  await search(page).press("ArrowDown");
  await expect(page.getByRole("option").filter({ hasText: /Massachusetts/ })).toHaveAttribute("aria-selected", "true");
  await search(page).press("Enter");
  await expect(card(page, "Springfield")).toContainText("Massachusetts");
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue("");
});

test("reduced motion keeps the atmospheric background static without a canvas", async ({ page }) => {
  await mockDashboardApi(page);
  await seedPlaces(page, [places.london]);
  await page.goto("/");
  await expect(card(page, "London")).toContainText("Moderate rain");
  const atmosphere = page.locator("[data-renderer]");
  await expect(atmosphere).toHaveAttribute("data-renderer", "static");
  await expect(atmosphere.locator("canvas")).toHaveCount(0);
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
});

test("removing and readding a failed location clears its previous atmosphere", async ({ page }) => {
  const api = await mockDashboardApi(page);
  await page.goto("/");
  await choosePlace(page, "London", /United Kingdom/);
  await expect(card(page, "London")).toContainText("Moderate rain");
  await expect(page.locator(".hero-note")).toContainText("Moderate rain");
  api.failingWeather.add(places.london.id);
  await page.getByRole("button", { name: "Remove London", exact: true }).click();
  await expect(card(page, "London")).toHaveCount(0);
  await choosePlace(page, "London", /United Kingdom/);
  await expect(card(page, "London")).toContainText("took too long to respond");
  await expect(page.locator(".hero-note")).toContainText("Connecting to its sky");
  await expect(page.locator(".hero-note")).not.toContainText("Moderate rain");
  await expect(page.locator("[data-condition]")).toHaveAttribute("data-condition", "cloudy");
});

test("Escape prevents hidden selection and ArrowUp reopens the search results", async ({ page }) => {
  await mockDashboardApi(page);
  await page.goto("/");
  await search(page).fill("Springfield");
  await expect(page.getByRole("option")).toHaveCount(2);
  await search(page).press("ArrowDown");
  await search(page).press("Escape");
  await expect(search(page)).toHaveAttribute("aria-expanded", "false");
  await expect(search(page)).not.toHaveAttribute("aria-activedescendant");
  await search(page).press("Enter");
  await expect(page.getByText("0 of 4 places", { exact: true })).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
  await search(page).press("ArrowUp");
  await expect(search(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("option").filter({ hasText: /Illinois/ })).toHaveAttribute("aria-selected", "true");
  await search(page).press("Enter");
  await expect(card(page, "Springfield")).toContainText("Illinois");
});

test("keyboard removal returns focus to the newly enabled place search", async ({ page }) => {
  await mockDashboardApi(page);
  await seedPlaces(page, [places.springfieldMassachusetts, places.london, places.tokyo, places.reykjavik]);
  await page.goto("/");
  await expect(search(page)).toBeDisabled();
  const remove = page.getByRole("button", { name: "Remove London", exact: true });
  await remove.focus();
  await remove.press("Enter");
  await expect(card(page, "London")).toHaveCount(0);
  await expect(search(page)).toBeEnabled();
  await expect(search(page)).toBeFocused();
  await expect(page.getByText("3 of 4 places", { exact: true })).toBeVisible();
});

test("late search results cannot replace a newer query's matches", async ({ page }) => {
  const api = await mockDashboardApi(page);
  const oldSearch = api.delaySearch("London");
  await page.goto("/");
  await search(page).fill("London");
  await oldSearch.started;
  await search(page).fill("Tokyo");
  await expect(page.getByRole("option").filter({ hasText: /Japan/ })).toHaveCount(1);
  oldSearch.release();
  await oldSearch.completed;
  await expect(page.getByRole("option").filter({ hasText: /United Kingdom/ })).toHaveCount(0);
  await page.getByRole("option").filter({ hasText: /Japan/ }).click();
  await expect(card(page, "Tokyo")).toContainText("Moderate rain");
  await expect(card(page, "London")).toHaveCount(0);
});

test("blocked cookies and storage keep selections usable and explain the reload limitation", async ({ page }) => {
  await mockDashboardApi(page);
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Test storage denied", "QuotaExceededError"); };
    Object.defineProperty(document, "cookie", { configurable: true, get: () => "", set: () => {} });
  });
  await page.goto("/");
  await choosePlace(page, "London", /United Kingdom/);
  await expect(card(page, "London")).toContainText("Moderate rain");
  const allowCookies = page.getByRole("button", { name: "Allow cookies", exact: true });
  if (await allowCookies.isVisible()) await allowCookies.click();
  await expect(page.getByRole("alert").filter({ hasText: "Your browser could not save" })).toBeVisible();
  await choosePlace(page, "Tokyo", /Japan/);
  await expect(card(page, "Tokyo")).toContainText("Moderate rain");
  await expect(page.getByText("2 of 4 places", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("0 of 4 places", { exact: true })).toBeVisible();
});

test("long place and admin names remain readable without horizontal overflow", async ({ page }) => {
  const api = await mockDashboardApi(page);
  const name = `Southeast Coastal Regional ${"Astronomical Observatory ".repeat(5)}`.trim();
  const admin1 = "Northern Highlands ".repeat(8).trim();
  api.extraPlaces.push({ ...places.london, id: 999989, name, admin1 });
  await page.goto("/");
  await search(page).fill("Southeast");
  await page.getByRole("option").filter({ hasText: name }).click();
  await expect(card(page, name)).toContainText(name);
  await expect(card(page, name)).toContainText(admin1);
  await expect(card(page, name)).toContainText("Moderate rain");
  const bounds = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  expect(bounds.content).toBeLessThanOrEqual(bounds.width + 1);
});
