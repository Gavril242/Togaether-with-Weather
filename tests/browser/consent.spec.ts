import { expect, test, type Page } from "@playwright/test";
import { CONSENT_COOKIE_NAME, COOKIE_NAME, mockDashboardApi, places, seedCookie, seedPlaces, STORAGE_KEY } from "./fixtures";

const search = (page: Page) => page.getByRole("combobox", { name: "Find your next place" });
const card = (page: Page, name: string) => page.getByRole("article", { name: `Weather for ${name}`, exact: true });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Remember your places?" });
async function choose(page: Page, name: string, country: string) {
  await search(page).fill(name);
  await page.getByRole("option").filter({ hasText: country }).click();
}

test.beforeEach(async ({ page }) => page.emulateMedia({ reducedMotion: "reduce" }));

test("no preference cookies or storage are written before Allow cookies", async ({ page }) => {
  await mockDashboardApi(page, { consent: "undecided" });
  await page.goto("/");
  await expect(dialog(page)).toBeVisible();
  await choose(page, "London", "United Kingdom");
  await expect(card(page, "London")).toContainText("Moderate rain");
  expect((await page.context().cookies()).filter((cookie) => cookie.name.startsWith("fourcast"))).toEqual([]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  await page.getByRole("button", { name: "Allow cookies", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === CONSENT_COOKIE_NAME)?.value).toBe("allow");
  expect(cookies.find((cookie) => cookie.name === COOKIE_NAME)?.value).toBe(`1.${places.london.id}`);
  await page.reload();
  await expect(card(page, "London")).toContainText("Moderate rain");
  await expect(dialog(page)).toHaveCount(0);
});

test("legacy four-place preferences remain readable and untouched until acceptance", async ({ page }) => {
  await mockDashboardApi(page, { consent: "undecided" });
  const initial = [places.springfieldMassachusetts, places.london, places.tokyo, places.reykjavik];
  await seedPlaces(page, initial);
  await page.goto("/");
  await expect(dialog(page)).toBeVisible();
  for (const place of initial) await expect(card(page, place.name)).toContainText("Moderate rain");
  expect((await page.context().cookies()).filter((cookie) => cookie.name.startsWith("fourcast"))).toEqual([]);
  const old = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(old).toBe(JSON.stringify({ version: 1, locations: initial }));
  await page.getByRole("button", { name: "Allow cookies", exact: true }).click();
  expect((await page.context().cookies()).find((cookie) => cookie.name === COOKIE_NAME)?.value).toBe(`1.${initial.map((place) => place.id).join(".")}`);
});

test("Only this tab clears persistent preferences and keeps current places through this tab's reload", async ({ page }) => {
  await mockDashboardApi(page, { consent: "undecided" });
  await seedCookie(page, [places.london.id]);
  await page.goto("/");
  await expect(card(page, "London")).toContainText("Moderate rain");
  await page.getByRole("button", { name: "Only this tab", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await choose(page, "Tokyo", "Japan");
  await expect(card(page, "Tokyo")).toContainText("Moderate rain");
  expect((await page.context().cookies()).filter((cookie) => cookie.name.startsWith("fourcast"))).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("fourcast.locations.v1"))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem("fourcast.consent.session.v1"))).toBe("tab");
  await page.reload();
  await expect(card(page, "London")).toContainText("Moderate rain");
  await expect(card(page, "Tokyo")).toContainText("Moderate rain");
  await expect(dialog(page)).toHaveCount(0);
});

test("preferences can revoke persistence and reset only this app's saved data", async ({ page }) => {
  await mockDashboardApi(page, { consent: "undecided" });
  await page.goto("/");
  await choose(page, "London", "United Kingdom");
  await page.getByRole("button", { name: "Allow cookies", exact: true }).click();
  await page.getByRole("button", { name: "Cookie preferences", exact: true }).click();
  await expect(dialog(page)).toContainText("Current choice: remember places");
  await page.getByRole("button", { name: "Only this tab", exact: true }).click();
  await expect(card(page, "London")).toContainText("Moderate rain");
  expect((await page.context().cookies()).filter((cookie) => cookie.name.startsWith("fourcast"))).toEqual([]);
  await page.evaluate(() => localStorage.setItem("unrelated.preference", "preserve"));
  await page.getByRole("button", { name: "Cookie preferences", exact: true }).click();
  await page.getByRole("button", { name: "Reset saved places", exact: true }).click();
  await expect(page.getByText("0 of 4 places", { exact: true })).toBeVisible();
  await expect(dialog(page)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("unrelated.preference"))).toBe("preserve");
  expect(await page.evaluate(() => sessionStorage.getItem("fourcast.locations.tab.v1"))).toBeNull();
});

test("keyboard users can manage consent, close preferences and recover focus", async ({ page }) => {
  await mockDashboardApi(page, { consent: "undecided" });
  await page.goto("/");
  const tab = page.getByRole("button", { name: "Only this tab", exact: true });
  await tab.focus();
  await tab.press("Enter");
  const manage = page.getByRole("button", { name: "Cookie preferences", exact: true });
  await expect(manage).toBeFocused();
  await manage.press("Enter");
  await expect(page.getByRole("button", { name: "Allow cookies", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Allow cookies", exact: true }).press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(manage).toBeFocused();
});
