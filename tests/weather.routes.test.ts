import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({ searchLocations: vi.fn(), getWeather: vi.fn() }));
vi.mock("../src/server/weather/service", () => service);

import { GET as searchRoute } from "../src/app/api/locations/route";
import { GET as weatherRoute } from "../src/app/api/weather/route";
import { GET as healthRoute } from "../src/app/api/health/route";
import { WeatherServiceError } from "../src/server/weather/errors";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("weather HTTP routes", () => {
  it("reports no search matches as a successful empty result", async () => {
    service.searchLocations.mockResolvedValue([]);
    const response = await searchRoute(new Request("http://localhost/api/locations?q=NoSuchPlace"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ locations: [] });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects missing and duplicated search parameters", async () => {
    const missing = await searchRoute(new Request("http://localhost/api/locations"));
    const repeated = await searchRoute(new Request("http://localhost/api/locations?q=Paris&q=London"));
    expect(missing.status).toBe(400);
    expect(repeated.status).toBe(400);
    expect(service.searchLocations).not.toHaveBeenCalled();
  });

  it.each(["", "?locationId=0", "?locationId=1e5", "?locationId=123&locationId=456"])("rejects invalid location queries %s", async (query) => {
    const response = await weatherRoute(new Request(`http://localhost/api/weather${query}`));
    expect(response.status).toBe(400);
    expect(service.getWeather).not.toHaveBeenCalled();
  });

  it("passes canonical location IDs and preserves stale warnings", async () => {
    const result = { weather: { temperatureC: 21 }, cache: { status: "stale", ageSeconds: 420 }, warning: "Showing cached weather." };
    service.getWeather.mockResolvedValue(result);
    const response = await weatherRoute(new Request("http://localhost/api/weather?locationId=4250542"));
    expect(service.getWeather).toHaveBeenCalledWith(4250542);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
  });

  it("returns clear provider errors without exception traces", async () => {
    service.getWeather.mockRejectedValue(new WeatherServiceError("UPSTREAM_TIMEOUT", "The weather service took too long to respond. Please try again.", 504, true));
    const response = await weatherRoute(new Request("http://localhost/api/weather?locationId=4250542"));
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: {
      code: "UPSTREAM_TIMEOUT", message: "The weather service took too long to respond. Please try again.", retryable: true,
    } });
  });

  it("sanitizes unexpected internal failures", async () => {
    service.getWeather.mockRejectedValue(new Error("secret connection string"));
    const response = await weatherRoute(new Request("http://localhost/api/weather?locationId=4250542"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
  });

  it("liveness does not depend on external weather services", async () => {
    const response = healthRoute();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "togaether-weather" });
    expect(service.getWeather).not.toHaveBeenCalled();
    expect(service.searchLocations).not.toHaveBeenCalled();
  });
});
