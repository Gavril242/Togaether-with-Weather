import "server-only";
import { isIP } from "node:net";
import { WeatherServiceError } from "../weather/errors";

type Bucket = { tokens: number; updatedAt: number };

/** Bounded, in-process admission for this single origin. No IPs are logged. */
export function createRequestBudget(now: () => number = Date.now) {
  const clients = new Map<string, Bucket>();
  const global: Bucket = { tokens: 120, updatedAt: now() };

  function refill(bucket: Bucket, capacity: number, perMinute: number, at: number) {
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, at - bucket.updatedAt) * perMinute / 60_000);
    bucket.updatedAt = Math.max(bucket.updatedAt, at);
  }

  return (key: string) => {
    const at = now();
    refill(global, 120, 120, at);
    const client = clients.get(key) ?? { tokens: 30, updatedAt: at };
    refill(client, 30, 60, at);
    clients.delete(key);
    if (clients.size >= 512) clients.delete(clients.keys().next().value!);
    clients.set(key, client);
    if (global.tokens < 1 || client.tokens < 1) {
      throw new WeatherServiceError("REQUEST_LIMIT", "Too many weather requests. Please try again in a minute.", 429, true);
    }
    global.tokens -= 1;
    client.tokens -= 1;
  };
}

export function requestClientKey(request: Request, trustCloudflare = false): string {
  const address = trustCloudflare ? request.headers.get("CF-Connecting-IP") : null;
  return address && address.length <= 45 && isIP(address) ? address : "local";
}

const shared = globalThis as typeof globalThis & { fourcastWeatherBudget?: ReturnType<typeof createRequestBudget> };
const admit = shared.fourcastWeatherBudget ??= createRequestBudget();

export function enforceWeatherBudget(request: Request): void {
  // Enable only behind the connector with an origin bound to loopback.
  admit(requestClientKey(request, process.env.TRUST_CLOUDFLARE_PROXY === "true"));
}
