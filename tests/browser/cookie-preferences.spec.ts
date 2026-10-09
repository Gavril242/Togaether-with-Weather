import { expect, test, type Page } from "@playwright/test";
import { COOKIE_NAME, mockDashboardApi, places, seedCookie, seedPlaces } from "./fixtures";

const search = (page: Page) => page.getByRole("combobox", { name: "Find your next place" });
const card = (page: Page, name: string) => page.getByRole("article", { name: `Weather for ${name}`, exact: true });

async function choose(page: Page, query: string, match: string) {
  await search(page).fill(query);
  await page.getByRole("option").filter({ hasText: match }).click();
}

async function preference(page: Page) {
  return (await page.context().cookies()).find((cookie) => cookie.name === COOKIE_NAME);
}

test.beforeEach(async ({ page }) => page.emulateMedia({ reducedMotion: "reduce" }));

test("migrates existing places to a compact cookie and saves replacement IDs", async ({ page }) => {
  const api = await mockDashboardApi(page);
  const initial = [places.springfieldMassachusetts, places.london, places.tokyo, places.reykjavik];
  await seedPlaces(page, initial);
  await page.goto("/");
  await expect(card(page, "London")).toContainText("Moderate rain");
  const cookie = await preference(page);
  expect(cookie?.value).toBe(`1.${initial.map((place) => place.id).join(".")}`);
  expect(cookie?.sameSite).toBe("Lax");
  expect(cookie?.path).toBe("/");
  expect(cookie?.value).not.toContain("London");
  expect(api.requestedRestorations).toEqual([]);
  await page.getByRole("button", { name: "Remove London", exact: true }).click();
  await choose(page, "Cape Town", "South Africa");
  await expect(card(page, "Cape Town")).toContainText("Moderate rain");
  expect((await preference(page))?.value).toBe(`1.${places.springfieldMassachusetts.id}.${places.tokyo.id}.${places.reykjavik.id}.${places.capeTown.id}`);
});

test("restores all four places from cookies without local metadata and fetches fresh weather", async ({ page }) => {
  const api = await mockDashboardApi(page);
  await seedCookie(page, [places.springfieldMassachusetts.id, places.london.id, places.tokyo.id, places.reykjavik.id]);
  await page.goto("/");
  for (const name of ["Springfield", "London", "Tokyo", "Reykjavik"]) await expect(card(page, name)).toContainText("Moderate rain");
  expect(api.requestedRestorations).toEqual([[places.springfieldMassachusetts.id, places.london.id, places.tokyo.id, places.reykjavik.id]]);
  const firstRequests = api.requestedWeather.length;
  await page.reload();
  await expect(card(page, "London")).toContainText("Moderate rain");
  await expect.poll(() => api.requestedWeather.length).toBeGreaterThan(firstRequests);
  await expect(page.getByText("4 of 4 places", { exact: true })).toBeVisible();
});

test("cookies preserve selections when browser localStorage reads and writes are blocked", async ({ page }) => {
  await mockDashboardApi(page);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("Test storage denied", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("Test storage denied", "SecurityError"); };
  });
  await page.goto("/");
  await choose(page, "London", "United Kingdom");
  await choose(page, "Tokyo", "Japan");
  await expect(card(page, "Tokyo")).toContainText("Moderate rain");
  expect((await preference(page))?.value).toBe(`1.${places.london.id}.${places.tokyo.id}`);
  await page.reload();
  await expect(card(page, "London")).toContainText("Moderate rain");
  await expect(card(page, "Tokyo")).toContainText("Moderate rain");
  await expect(page.getByText("2 of 4 places", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "could not save" })).toHaveCount(0);
});

test("localStorage remains a working fallback when cookie access is blocked", async ({ page }) => {
  await mockDashboardApi(page);
  await page.addInitScript(() => {
    Object.defineProperty(document, "cookie", { configurable: true, get: () => "", set: () => {} });
  });
  await page.goto("/");
  await choose(page, "London", "United Kingdom");
  await expect(card(page, "London")).toContainText("Moderate rain");
  await page.reload();
  await expect(card(page, "London")).toContainText("Moderate rain");
  await expect(page.getByText("1 of 4 places", { exact: true })).toBeVisible();
});

test("newer local selections survive reload when an old cookie cannot be updated", async ({ page }) => {
  await mockDashboardApi(page);
  await seedCookie(page, [places.london.id]);
  await page.addInitScript(() => {
    const nativeGet = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")?.get;
    if (!nativeGet) throw new Error("Cookie accessor unavailable");
    Object.defineProperty(document, "cookie", { configurable: true, get: () => nativeGet.call(document), set: () => {} });
  });
  await page.goto("/");
  await expect(card(page, "London")).toContainText("Moderate rain");
  await choose(page, "Tokyo", "Japan");
  await expect(card(page, "Tokyo")).toContainText("Moderate rain");
  expect((await preference(page))?.value).toBe(`1.${places.london.id}`);
  await page.reload();
  await expect(card(page, "London")).toContainText("Moderate rain");
  await expect(card(page, "Tokyo")).toContainText("Moderate rain");
  await expect(page.getByText("2 of 4 places", { exact: true })).toBeVisible();
});

test("a late cookie restoration cannot replace a new user selection", async ({ page }) => {
  const api = await mockDashboardApi(page);
  await seedCookie(page, [places.london.id]);
  const restoration = api.delayRestore();
  await page.goto("/");
  await restoration.started;
  await choose(page, "Tokyo", "Japan");
  restoration.release();
  await restoration.completed;
  await expect(card(page, "Tokyo")).toContainText("Moderate rain");
  await expect(card(page, "London")).toHaveCount(0);
  expect((await preference(page))?.value).toBe(`1.${places.tokyo.id}`);
});

test("a failed saved lookup is isolated and retried on reload without losing its ID", async ({ page }) => {
  const api = await mockDashboardApi(page);
  await seedCookie(page, [places.london.id, places.tokyo.id]);
  api.failingRestorations.add(places.london.id);
  await page.goto("/");
  await expect(card(page, "Tokyo")).toContainText("Moderate rain");
  await expect(page.getByRole("alert").filter({ hasText: "Some saved places could not be restored" })).toBeVisible();
  expect((await preference(page))?.value).toBe(`1.${places.london.id}.${places.tokyo.id}`);
  api.failingRestorations.delete(places.london.id);
  await page.reload();
  await expect(card(page, "London")).toContainText("Moderate rain");
  await expect(card(page, "Tokyo")).toContainText("Moderate rain");
  await expect(page.getByRole("alert").filter({ hasText: "could not be restored" })).toHaveCount(0);
});

test("invalid cookie IDs never trigger lookup and are replaced by a valid selection", async ({ page }) => {
  const api = await mockDashboardApi(page);
  await seedCookie(page, "1.2643743.2643743");
  await page.goto("/");
  await expect(page.getByRole("alert").filter({ hasText: "Saved place cookie could not be restored" })).toBeVisible();
  expect(api.requestedRestorations).toEqual([]);
  await choose(page, "Tokyo", "Japan");
  await expect(card(page, "Tokyo")).toContainText("Moderate rain");
  expect((await preference(page))?.value).toBe(`1.${places.tokyo.id}`);
});
