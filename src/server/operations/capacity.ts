import "server-only";
import { WeatherServiceError } from "../weather/errors";

/** Immediate admission; waiting requests never create a growing server queue. */
export function createUpstreamCapacity(limit = 8) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Upstream capacity must be a positive integer");
  let active = 0;
  return async function run<T>(operation: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      throw new WeatherServiceError("SERVICE_BUSY", "The weather service is busy. Please try again shortly.", 503, true);
    }
    active += 1;
    try {
      return await operation();
    } finally {
      active -= 1;
    }
  };
}

const shared = globalThis as typeof globalThis & { fourcastWeatherCapacity?: ReturnType<typeof createUpstreamCapacity> };
export const withUpstreamCapacity = shared.fourcastWeatherCapacity ??= createUpstreamCapacity();
