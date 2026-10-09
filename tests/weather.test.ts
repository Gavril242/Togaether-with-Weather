import { describe, expect, it, vi } from "vitest";
import { locationIdQuerySchema } from "../src/domain/locations";
import { localDateAt, type WeatherSnapshot } from "../src/domain/weather";
import { BoundedCache } from "../src/server/weather/cache";
import { errorResponse, WeatherServiceError } from "../src/server/weather/errors";
import { fetchWeatherJson, type FetchLike } from "../src/server/weather/http";
import { forecastUrl, parseForecast, parseLocation, parseLocations } from "../src/server/weather/open-meteo";
import { createWeatherService } from "../src/server/weather/service";

// Open-Meteo field shapes and Springfield, Illinois coordinates verified against
// /v1/get?id=4250542. Forecast values are deterministic provider fixtures.
const providerLocation = {
  id: 4250542,
  name: "Springfield",
  latitude: 39.80172,
  longitude: -89.64371,
  timezone: "America/Chicago",
  country: "United States",
  country_code: "US",
  admin1: "Illinois",
};
const location = parseLocation(providerLocation, providerLocation.id);
const noonChicago = Date.parse("2026-10-09T17:00:00Z");

function forecast(now = noonChicago, timezone = "America/Chicago", offset = -18_000) {
  const localDate = localDateAt(now, timezone);
  const midnightUtc = Date.parse(`${localDate}T00:00:00Z`) / 1000 - offset;
  return {
    timezone,
    utc_offset_seconds: offset,
    current_units: { time: "unixtime", temperature_2m: "°C", wind_speed_10m: "km/h" },
    current: { time: Math.floor(now / 1000), temperature_2m: 19.2, weather_code: 63, wind_speed_10m: 12.4, is_day: 1 },
    daily_units: { time: "unixtime", temperature_2m_max: "°C", temperature_2m_min: "°C" },
    daily: { time: [midnightUtc], temperature_2m_max: [23.4], temperature_2m_min: [10.8] },
  };
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

describe("canonical location input", () => {
  it("retains admin areas so matching names can be distinguished", () => {
    const matches = parseLocations({ results: [providerLocation, { ...providerLocation, id: 4951788, admin1: "Massachusetts" }] });
    expect(matches.map((match) => [match.id, match.admin1, match.countryCode])).toEqual([
      [4250542, "Illinois", "US"], [4951788, "Massachusetts", "US"],
    ]);
  });

  it("accepts no matches without inventing a location", () => {
    expect(parseLocations({ generationtime_ms: 0.2 })).toEqual([]);
  });

  it("rejects invalid provider zones and mismatched canonical IDs", () => {
    expect(() => parseLocation({ ...providerLocation, timezone: "Mars/Olympus" }, 4250542)).toThrow(WeatherServiceError);
    expect(() => parseLocation(providerLocation, 10)).toThrow(WeatherServiceError);
  });

  it.each(["0", "-1", "1.1", "1e4", "01", "2147483648", "https://localhost", "123&latitude=4"])("rejects noncanonical IDs: %s", (id) => {
    expect(locationIdQuerySchema.safeParse(id).success).toBe(false);
  });
});

describe("forecast normalization", () => {
  it("takes conditions and units from validated weather data", () => {
    const weather = parseForecast(forecast(), location, noonChicago);
    expect(weather).toMatchObject({
      temperatureC: 19.2, windKmh: 12.4, highC: 23.4, lowC: 10.8,
      weatherCode: 63, category: "rain", condition: "Moderate rain",
      units: { temperature: "°C", wind: "km/h" },
      observedAt: "2026-10-09T17:00:00.000Z", localDate: "2026-10-09",
    });
  });

  it("selects today in Auckland after local midnight while UTC is the previous date", () => {
    const now = Date.parse("2026-10-09T11:10:00Z"); // October 10, 00:10 NZDT
    const fixture = forecast(now, "Pacific/Auckland", 46_800);
    fixture.current.time -= 900; // Observation can still fall on the prior local day.
    expect(parseForecast(fixture, { ...location, timezone: "Pacific/Auckland" }, now)).toMatchObject({
      localDate: "2026-10-10", highC: 23.4, lowC: 10.8,
      observedAt: "2026-10-09T10:55:00.000Z",
    });
  });

  it("uses fixed provider offsets for daily dates across the DST transition", () => {
    const now = Date.parse("2026-03-29T12:00:00Z"); // CEST after the change
    const fixture = forecast(now, "Europe/Berlin", 7200);
    // API midnight with the request-time +2 offset is March 28, 22:00 UTC.
    // At that instant the real IANA offset was still +1, so formatting this
    // daily boundary with the IANA zone would mislabel it as March 28.
    expect(localDateAt(fixture.daily.time[0] * 1000, "Europe/Berlin")).toBe("2026-03-28");
    expect(parseForecast(fixture, { ...location, timezone: "Europe/Berlin" }, now).localDate).toBe("2026-03-29");
  });

  it("finds today's daily record even if it is not the first array element", () => {
    const fixture = forecast();
    fixture.daily.time.unshift(fixture.daily.time[0] - 86_400);
    fixture.daily.temperature_2m_max.unshift(99);
    fixture.daily.temperature_2m_min.unshift(9);
    // Keep the prior high valid but visibly different.
    fixture.daily.temperature_2m_max[0] = 70;
    expect(parseForecast(fixture, location, noonChicago).highC).toBe(23.4);
  });

  it("rejects missing today's record, incorrect units and inconsistent arrays", () => {
    const missingToday = forecast();
    missingToday.daily.time = missingToday.daily.time.map((time) => time + 86_400);
    expect(() => parseForecast(missingToday, location, noonChicago)).toThrow(WeatherServiceError);
    const wrongUnits = { ...forecast(), current_units: { ...forecast().current_units, temperature_2m: "°F" } };
    expect(() => parseForecast(wrongUnits, location, noonChicago)).toThrow(WeatherServiceError);
    const uneven = forecast();
    uneven.daily.temperature_2m_min.pop();
    expect(() => parseForecast(uneven, location, noonChicago)).toThrow(WeatherServiceError);
  });

  it("rejects null conditions, impossible high/low and old current observations", () => {
    const bad = forecast();
    bad.daily.temperature_2m_min[0] = 40;
    expect(() => parseForecast(bad, location, noonChicago)).toThrow(WeatherServiceError);
    expect(() => parseForecast({ ...forecast(), current: { ...forecast().current, temperature_2m: null } }, location, noonChicago)).toThrow(WeatherServiceError);
    const old = forecast();
    old.current.time -= 3 * 3600;
    expect(() => parseForecast(old, location, noonChicago)).toThrow(/old conditions/);
  });

  it("uses only the fixed forecast origin and explicit requested units", () => {
    const url = forecastUrl(location);
    expect(url.origin).toBe("https://api.open-meteo.com");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      latitude: "39.80172", longitude: "-89.64371", timezone: "auto",
      timeformat: "unixtime", temperature_unit: "celsius", wind_speed_unit: "kmh", forecast_days: "1",
    });
  });
});

describe("bounded cache and independent weather failures", () => {
  it("coalesces in-flight requests for the same location", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return json(url.includes("/v1/get") ? providerLocation : forecast());
    });
    const service = createWeatherService({ fetcher: fetcher as FetchLike, now: () => noonChicago });
    const [a, b] = await Promise.all([service.getWeather(4250542), service.getWeather(4250542)]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(a.weather).toEqual(b.weather);
    expect(a.cache).toEqual({ status: "fresh", ageSeconds: 0 });
  });

  it("labels stale data on refresh failure and stops using it after 30 minutes", async () => {
    let now = noonChicago;
    let failForecast = false;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/v1/get")) return json(providerLocation);
      if (failForecast) return json({ reason: "internal provider detail" }, 503);
      return json(forecast());
    });
    const service = createWeatherService({ fetcher: fetcher as FetchLike, now: () => now });
    await service.getWeather(4250542);
    now += 6 * 60_000;
    failForecast = true;
    expect(await service.getWeather(4250542)).toMatchObject({ cache: { status: "stale", ageSeconds: 360 }, warning: expect.any(String) });
    now += 25 * 60_000;
    await expect(service.getWeather(4250542)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  it("never serves yesterday's high and low from cache after midnight", async () => {
    let now = Date.parse("2026-10-10T04:59:00Z"); // 23:59 Chicago
    let fail = false;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/v1/get")) return json(providerLocation);
      return fail ? json({}, 503) : json(forecast(now));
    });
    const service = createWeatherService({ fetcher: fetcher as FetchLike, now: () => now });
    expect((await service.getWeather(4250542)).weather.localDate).toBe("2026-10-09");
    now += 2 * 60_000;
    fail = true;
    await expect(service.getWeather(4250542)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  it("evicts least recently used records at the memory bound", async () => {
    const cache = new BoundedCache<number>(2, 60_000, 60_000, () => 0);
    await cache.get("one", async () => 1);
    await cache.get("two", async () => 2);
    await cache.get("one", async () => 99); // Mark one used.
    await cache.get("three", async () => 3);
    const load = vi.fn(async () => 20);
    expect((await cache.get("two", load)).value).toBe(20);
    expect(load).toHaveBeenCalledOnce();
  });

  it("caps simultaneous distinct upstream work", async () => {
    const cache = new BoundedCache<number>(2, 60_000, 60_000, () => 0, 1);
    let release!: (value: number) => void;
    const first = cache.get("one", () => new Promise<number>((resolve) => { release = resolve; }));
    await Promise.resolve();
    await expect(cache.get("two", async () => 2)).rejects.toMatchObject({ code: "SERVICE_BUSY" });
    release(1);
    await first;
    expect((await cache.get("two", async () => 2)).value).toBe(2);
  });

  it("rejects invalid user input before touching the provider", async () => {
    const fetcher = vi.fn();
    const service = createWeatherService({ fetcher: fetcher as FetchLike });
    await expect(service.searchLocations("x")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.searchLocations("London\u0000")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.getWeather(-2)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("a failing location does not poison another location's weather", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/get") {
        return url.searchParams.get("id") === "999999" ? json({ error: true }, 400) : json(providerLocation);
      }
      return json(forecast());
    });
    const service = createWeatherService({ fetcher: fetcher as FetchLike, now: () => noonChicago });
    const [bad, good] = await Promise.allSettled([service.getWeather(999999), service.getWeather(4250542)]);
    expect(bad.status).toBe("rejected");
    expect(good.status).toBe("fulfilled");
  });
});

describe("external HTTP boundary", () => {
  const url = new URL("https://api.open-meteo.com/v1/forecast");

  it("does not follow redirects and passes a timeout signal", async () => {
    const fetcher = vi.fn(async () => json({ ok: true }));
    await fetchWeatherJson(url, fetcher as FetchLike);
    expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({
      redirect: "error", signal: expect.any(AbortSignal), cache: "no-store",
    }));
  });

  it("sanitizes provider failures and never forwards response body details", async () => {
    const failed: FetchLike = async () => json({ reason: "password and network details" }, 503);
    try {
      await fetchWeatherJson(url, failed);
      throw new Error("Expected request failure");
    } catch (error) {
      const response = errorResponse(error);
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain("password");
    }
  });

  it("maps aborts to actionable timeout errors", async () => {
    const timedOut: FetchLike = async () => { throw new DOMException("raw detail", "TimeoutError"); };
    await expect(fetchWeatherJson(url, timedOut)).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT", status: 504, retryable: true });
  });

  it("rejects malformed JSON, oversized responses and unexpected origins", async () => {
    const malformed: FetchLike = async () => new Response("<html>gateway error</html>");
    await expect(fetchWeatherJson(url, malformed)).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE" });
    const oversized: FetchLike = async () => new Response("{}", { headers: { "content-length": "600000" } });
    await expect(fetchWeatherJson(url, oversized)).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE" });
    const notCalled = vi.fn();
    await expect(fetchWeatherJson(new URL("http://127.0.0.1/private"), notCalled as FetchLike)).rejects.toThrow(/origin/);
    expect(notCalled).not.toHaveBeenCalled();
  });

  it("reports throttling and a fixed retry interval", async () => {
    const limited: FetchLike = async () => json({}, 429);
    let error: unknown;
    try { await fetchWeatherJson(url, limited); } catch (caught) { error = caught; }
    const response = errorResponse(error);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
  });

  it("reserves location-not-found errors for canonical location resolution", async () => {
    const missing: FetchLike = async () => json({}, 404);
    await expect(fetchWeatherJson(new URL("https://geocoding-api.open-meteo.com/v1/get?id=123"), missing))
      .rejects.toMatchObject({ code: "LOCATION_NOT_FOUND", status: 404, retryable: false });
    await expect(fetchWeatherJson(new URL("https://geocoding-api.open-meteo.com/v1/search?name=Paris"), missing))
      .rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", status: 502, retryable: true });
    await expect(fetchWeatherJson(url, missing))
      .rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", status: 502, retryable: true });
  });
});

// Keeps the exported domain shape checked by the compiler alongside runtime tests.
const assertSnapshot = (value: WeatherSnapshot) => value.temperatureC;
void assertSnapshot;
