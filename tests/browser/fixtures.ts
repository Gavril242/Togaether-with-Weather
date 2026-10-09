import type { Page } from "@playwright/test";
import type { Location } from "../../src/domain/locations";
import { localDateAt, type WeatherResponse } from "../../src/domain/weather";

export const CLOCK_TIME = "2026-10-09T17:05:00.000Z";
export const STORAGE_KEY = "fourcast.locations.v1";
export const COOKIE_NAME = "fourcast_places_v1";
export const CONSENT_COOKIE_NAME = "fourcast_consent_v1";

export const places: Record<string, Location> = {
  springfieldIllinois: { id: 4250542, name: "Springfield", latitude: 39.80172, longitude: -89.64371, timezone: "America/Chicago", country: "United States", countryCode: "US", admin1: "Illinois" },
  springfieldMassachusetts: { id: 4951788, name: "Springfield", latitude: 42.10148, longitude: -72.58981, timezone: "America/New_York", country: "United States", countryCode: "US", admin1: "Massachusetts" },
  london: { id: 2643743, name: "London", latitude: 51.50853, longitude: -0.12574, timezone: "Europe/London", country: "United Kingdom", countryCode: "GB", admin1: "England" },
  tokyo: { id: 1850147, name: "Tokyo", latitude: 35.6895, longitude: 139.69171, timezone: "Asia/Tokyo", country: "Japan", countryCode: "JP", admin1: "Tokyo" },
  reykjavik: { id: 3413829, name: "Reykjavik", latitude: 64.13548, longitude: -21.89541, timezone: "Atlantic/Reykjavik", country: "Iceland", countryCode: "IS", admin1: "Capital Region" },
  capeTown: { id: 3369157, name: "Cape Town", latitude: -33.92584, longitude: 18.42322, timezone: "Africa/Johannesburg", country: "South Africa", countryCode: "ZA", admin1: "Western Cape" },
};

const temperatures: Record<number, number> = {
  4250542: 19.2, 4951788: 20.8, 2643743: 15.4, 1850147: 25.3, 3413829: 6.8, 3369157: 18.7,
};

export function weatherFor(location: Location): WeatherResponse {
  return {
    weather: {
      location,
      timezone: location.timezone,
      observedAt: "2026-10-09T17:00:00.000Z",
      fetchedAt: CLOCK_TIME,
      localDate: localDateAt(new Date(CLOCK_TIME), location.timezone),
      temperatureC: temperatures[location.id] ?? 12.5,
      windKmh: 12.4,
      highC: 26.2,
      lowC: 6.1,
      weatherCode: 63,
      condition: "Moderate rain",
      category: "rain",
      isDay: location.id !== places.tokyo.id,
      units: { temperature: "°C", wind: "km/h" },
    },
    cache: { status: "fresh", ageSeconds: 0 },
  };
}

/** Browser behavior uses deterministic provider-shaped fixtures, never live APIs. */
export async function mockDashboardApi(page: Page, options: { consent?: "allow" | "undecided" } = {}) {
  if (options.consent !== "undecided") {
    await page.context().addCookies([{ name: CONSENT_COOKIE_NAME, value: "allow", url: "http://127.0.0.1", sameSite: "Lax", expires: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60 }]);
    await page.addInitScript(() => { try { localStorage.setItem("fourcast.consent.v1", "allow"); } catch { /* The native cookie carries this fixture's previous choice. */ } });
  }
  const failingWeather = new Set<number>();
  const failingSearches = new Set<string>();
  const requestedWeather: number[] = [];
  const extraPlaces: Location[] = [];
  const failingRestorations = new Set<number>();
  const requestedRestorations: number[][] = [];
  let restorationDelay: { started: () => void; wait: Promise<void>; complete: () => void } | null = null;
  const searchDelays = new Map<string, { started: () => void; wait: Promise<void>; complete: () => void }>();
  const allPlaces = () => [...Object.values(places), ...extraPlaces];
  function delaySearch(query: string) {
    let markStarted!: () => void;
    let release!: () => void;
    let complete!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const completed = new Promise<void>((resolve) => { complete = resolve; });
    searchDelays.set(query.toLowerCase(), { started: markStarted, wait, complete });
    return { started, release, completed };
  }
  function delayRestore() {
    let markStarted!: () => void;
    let release!: () => void;
    let complete!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const completed = new Promise<void>((resolve) => { complete = resolve; });
    restorationDelay = { started: markStarted, wait, complete };
    return { started, release, completed };
  }
  await page.clock.setFixedTime(new Date(CLOCK_TIME));
  await page.route("**/api/locations/restore?**", async (route) => {
    const ids = (new URL(route.request().url()).searchParams.get("ids") ?? "").split(",").map(Number);
    requestedRestorations.push(ids);
    const delay = restorationDelay;
    if (delay) { delay.started(); await delay.wait; }
    try {
      const locations = ids.flatMap((id) => {
        const place = allPlaces().find((item) => item.id === id);
        return place && !failingRestorations.has(id) ? [place] : [];
      });
      await route.fulfill({ json: { locations, unavailableIds: ids.filter((id) => !locations.some((place) => place.id === id)) } });
    } finally { delay?.complete(); }
  });
  await page.route("**/api/locations?**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q")?.trim().toLowerCase() ?? "";
    const delay = searchDelays.get(query);
    if (delay) { delay.started(); await delay.wait; }
    try {
      if (failingSearches.has(query)) {
        await route.fulfill({ status: 504, json: { error: { code: "UPSTREAM_TIMEOUT", message: "Place search took too long to respond. Please try again.", retryable: true } } });
        return;
      }
      const locations = allPlaces().filter((place) => place.name.toLowerCase().startsWith(query));
      await route.fulfill({ json: { locations } });
    } finally {
      delay?.complete();
    }
  });
  await page.route("**/api/weather?**", async (route) => {
    const id = Number(new URL(route.request().url()).searchParams.get("locationId"));
    requestedWeather.push(id);
    if (failingWeather.has(id)) {
      await route.fulfill({ status: 504, json: { error: { code: "UPSTREAM_TIMEOUT", message: "The weather service took too long to respond. Please try again.", retryable: true } } });
      return;
    }
    const place = allPlaces().find((item) => item.id === id);
    if (!place) {
      await route.fulfill({ status: 404, json: { error: { code: "LOCATION_NOT_FOUND", message: "This location could not be found.", retryable: false } } });
      return;
    }
    await route.fulfill({ json: weatherFor(place) });
  });
  return { failingWeather, failingSearches, requestedWeather, delaySearch, extraPlaces, failingRestorations, requestedRestorations, delayRestore };
}

export async function seedPlaces(page: Page, locations: Location[]) {
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value);
  }, { key: STORAGE_KEY, value: JSON.stringify({ version: 1, locations }) });
}

export async function seedCookie(page: Page, ids: number[] | string) {
  await page.context().addCookies([{
    name: COOKIE_NAME,
    value: typeof ids === "string" ? ids : ["1", ...ids].join("."),
    url: "http://127.0.0.1",
    sameSite: "Lax",
    expires: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
  }]);
}
