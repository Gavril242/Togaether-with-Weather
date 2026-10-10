import "server-only";
import { isIP } from "node:net";
import { WeatherServiceError } from "../weather/errors";

const WINDOW_MS = 24 * 60 * 60_000;
const CLIENT_COOLDOWN_MS = 10 * 60_000;
const SERVER_DAILY_LIMIT = 10;

type Admission = { timestamps: number[]; clients: Map<string, number>; active: boolean };
const shared = globalThis as typeof globalThis & { fourcastImageAdmission?: Admission };
const state = shared.fourcastImageAdmission ??= { timestamps: [], clients: new Map(), active: false };

function clientKey(request: Request): string {
  const forwarded = process.env.TRUST_CLOUDFLARE_PROXY === "true" ? request.headers.get("CF-Connecting-IP") : null;
  return forwarded && forwarded.length <= 45 && isIP(forwarded) ? forwarded : "local";
}

/** Conservative single-process guard for optional, potentially billable image calls. */
export function beginImageRequest(request: Request, now = Date.now()): () => void {
  state.timestamps = state.timestamps.filter((timestamp) => now - timestamp < WINDOW_MS);
  const key = clientKey(request);
  const previous = state.clients.get(key);
  if (previous !== undefined && now - previous < CLIENT_COOLDOWN_MS) {
    throw new WeatherServiceError("IMAGE_RATE_LIMIT", "Please wait ten minutes before creating another image.", 429, true);
  }
  if (state.timestamps.length >= SERVER_DAILY_LIMIT) {
    throw new WeatherServiceError("IMAGE_DAILY_LIMIT", "The daily image limit has been reached. Try again tomorrow.", 429, true);
  }
  if (state.active) {
    throw new WeatherServiceError("IMAGE_BUSY", "Another image is being created. Please try again shortly.", 503, true);
  }
  if (state.clients.size >= 512) {
    const oldest = [...state.clients].sort((left, right) => left[1] - right[1])[0];
    if (oldest) state.clients.delete(oldest[0]);
  }
  state.timestamps.push(now);
  state.clients.set(key, now);
  state.active = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.active = false;
  };
}
