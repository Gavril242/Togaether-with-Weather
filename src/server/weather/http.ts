import { invalidProviderResponse, WeatherServiceError } from "./errors";

export type FetchLike = typeof fetch;

const ALLOWED_ORIGINS = new Set(["https://geocoding-api.open-meteo.com", "https://api.open-meteo.com"]);
const MAX_RESPONSE_BYTES = 512 * 1024;

export async function fetchWeatherJson(
  url: URL,
  fetcher: FetchLike = fetch,
  timeoutMs = 8_000,
): Promise<unknown> {
  if (!ALLOWED_ORIGINS.has(url.origin)) throw new Error("Unsupported weather origin");
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
      cache: "no-store",
    });
    if ((response.status === 404 || response.status === 400) && url.pathname === "/v1/get") {
      await response.body?.cancel();
      throw new WeatherServiceError("LOCATION_NOT_FOUND", "This location could not be found. Search for it again.", 404, false);
    }
    if (response.status === 429) {
      await response.body?.cancel();
      throw new WeatherServiceError("UPSTREAM_RATE_LIMITED", "The weather service reached its request limit. Please try again in a minute.", 429, true);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new WeatherServiceError("UPSTREAM_UNAVAILABLE", "The weather service is unavailable. Please try again shortly.", 502, true);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (declaredLength > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw invalidProviderResponse();
    }
    if (!response.body) throw invalidProviderResponse();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw invalidProviderResponse();
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(body)) as unknown;
    } catch {
      throw invalidProviderResponse();
    }
  } catch (error) {
    if (error instanceof WeatherServiceError) throw error;
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new WeatherServiceError("UPSTREAM_TIMEOUT", "The weather service took too long to respond. Please try again.", 504, true);
    }
    throw new WeatherServiceError("UPSTREAM_UNAVAILABLE", "The weather service could not be reached. Please try again shortly.", 502, true);
  }
}
