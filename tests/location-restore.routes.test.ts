import { beforeEach, describe, expect, it, vi } from "vitest";
const service = vi.hoisted(() => ({ resolveLocation: vi.fn() }));
const admission = vi.hoisted(() => ({ enforceWeatherBudget: vi.fn() }));
vi.mock("../src/server/weather/service", () => service);
vi.mock("../src/server/operations/budget", () => admission);
import { GET } from "../src/app/api/locations/restore/route";
import { WeatherServiceError } from "../src/server/weather/errors";

beforeEach(() => vi.resetAllMocks());

describe("canonical preference restoration", () => {
  it.each(["", "?ids=1,1", "?ids=1,2,3,4,5", "?ids=0", "?ids=001", "?ids=1&ids=2", "?ids=https://localhost"])("rejects malformed preferences before provider lookup: %s", async (query) => {
    const response = await GET(new Request(`http://localhost/api/locations/restore${query}`));
    expect(response.status).toBe(400);
    expect(service.resolveLocation).not.toHaveBeenCalled();
  });

  it("preserves requested order while isolating individual lookup failures", async () => {
    service.resolveLocation.mockImplementation(async (id: number) => {
      if (id === 20) throw new Error("Sensitive provider detail");
      return { id, name: String(id) };
    });
    const response = await GET(new Request("http://localhost/api/locations/restore?ids=30,20,10"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ locations: [{ id: 30, name: "30" }, { id: 10, name: "10" }], unavailableIds: [20] });
  });

  it("applies public admission before any canonical provider lookup", async () => {
    admission.enforceWeatherBudget.mockImplementation(() => {
      throw new WeatherServiceError("REQUEST_LIMIT", "Too many weather requests. Please try again in a minute.", 429, true);
    });
    const response = await GET(new Request("http://localhost/api/locations/restore?ids=2643743"));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(service.resolveLocation).not.toHaveBeenCalled();
  });
});
