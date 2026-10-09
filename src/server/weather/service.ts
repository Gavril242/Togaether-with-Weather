import "server-only";

import { locationIdSchema, searchQuerySchema, type Location } from "../../domain/locations";
import { localDateAt, type WeatherResponse, type WeatherSnapshot } from "../../domain/weather";
import { BoundedCache } from "./cache";
import { invalidInput } from "./errors";
import { fetchWeatherJson, type FetchLike } from "./http";
import { forecastUrl, locationUrl, parseForecast, parseLocation, parseLocations, searchUrl } from "./open-meteo";

export function createWeatherService(options: { fetcher?: FetchLike; now?: () => number; timeoutMs?: number } = {}) {
  const now = options.now ?? Date.now;
  const getJson = (url: URL) => fetchWeatherJson(url, options.fetcher ?? fetch, options.timeoutMs);
  const searches = new BoundedCache<Location[]>(128, 10 * 60_000, 10 * 60_000, now);
  const locations = new BoundedCache<Location>(512, 24 * 60 * 60_000, 7 * 24 * 60 * 60_000, now);
  const forecasts = new BoundedCache<WeatherSnapshot>(256, 5 * 60_000, 30 * 60_000, now);

  async function searchLocations(query: string): Promise<Location[]> {
    const parsed = searchQuerySchema.safeParse(query);
    if (!parsed.success) throw invalidInput("Enter a place name between 2 and 100 characters.");
    const result = await searches.get(parsed.data.toLocaleLowerCase("en"), async () =>
      parseLocations(await getJson(searchUrl(parsed.data))),
    );
    return result.value;
  }

  async function resolveLocation(id: number): Promise<Location> {
    const parsed = locationIdSchema.safeParse(id);
    if (!parsed.success) throw invalidInput("Choose a valid location from search results.");
    const result = await locations.get(String(id), async () => parseLocation(await getJson(locationUrl(id)), id));
    return result.value;
  }

  async function getWeather(id: number): Promise<WeatherResponse> {
    const location = await resolveLocation(id);
    const result = await forecasts.get(String(location.id), async () =>
      parseForecast(await getJson(forecastUrl(location)), location, now()),
      (snapshot) => snapshot.localDate === localDateAt(now(), snapshot.timezone),
    );
    return {
      weather: result.value,
      cache: { status: result.stale ? "stale" : "fresh", ageSeconds: Math.max(0, Math.floor((now() - result.storedAt) / 1000)) },
      ...(result.stale ? { warning: "Weather refresh failed. Showing previously fetched conditions from the time displayed." } : {}),
    };
  }

  return { searchLocations, resolveLocation, getWeather };
}

const service = createWeatherService();
export const searchLocations = service.searchLocations;
export const resolveLocation = service.resolveLocation;
export const getWeather = service.getWeather;
