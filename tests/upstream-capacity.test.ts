import { describe, expect, it, vi } from "vitest";
import { createUpstreamCapacity } from "../src/server/operations/capacity";
import { fetchWeatherJson, type FetchLike } from "../src/server/weather/http";

const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
const success: FetchLike = async () => Response.json({ ok: true });

describe("shared upstream capacity", () => {
  it("rejects a ninth active provider request without fetching or queuing it", async () => {
    const releases: Array<(response: Response) => void> = [];
    const held: FetchLike = async () => new Promise<Response>((resolve) => { releases.push(resolve); });
    const active = Array.from({ length: 8 }, () => fetchWeatherJson(weatherUrl, held));
    const ninth = vi.fn(success);
    try {
      await expect(fetchWeatherJson(new URL("https://geocoding-api.open-meteo.com/v1/search?name=Paris"), ninth))
        .rejects.toMatchObject({ code: "SERVICE_BUSY", status: 503, retryable: true });
      expect(ninth).not.toHaveBeenCalled();
    } finally {
      for (const release of releases) release(Response.json({ ok: true }));
      await Promise.all(active);
    }
    await expect(fetchWeatherJson(weatherUrl, success)).resolves.toEqual({ ok: true });
  });

  it("keeps capacity occupied until the response body has been consumed", async () => {
    const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
    const heldBodies: FetchLike = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { streams.push(controller); },
    }));
    const active = Array.from({ length: 8 }, () => fetchWeatherJson(weatherUrl, heldBodies));
    try {
      await expect(fetchWeatherJson(weatherUrl, success)).rejects.toMatchObject({ code: "SERVICE_BUSY" });
    } finally {
      for (const controller of streams) {
        controller.enqueue(new TextEncoder().encode('{"ok":true}'));
        controller.close();
      }
      await Promise.all(active);
    }
    await expect(fetchWeatherJson(weatherUrl, success)).resolves.toEqual({ ok: true });
  });

  it("preserves provider deadlines and releases every timed-out slot", async () => {
    const noResponse: FetchLike = async (_input, options) => new Promise<Response>((_resolve, reject) => {
      const signal = options?.signal;
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const active = Array.from({ length: 8 }, () => fetchWeatherJson(weatherUrl, noResponse, 20));
    await expect(fetchWeatherJson(weatherUrl, success)).rejects.toMatchObject({ code: "SERVICE_BUSY" });
    const results = await Promise.allSettled(active);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "UPSTREAM_TIMEOUT", status: 504 });
    }
    await expect(fetchWeatherJson(weatherUrl, success)).resolves.toEqual({ ok: true });
  });

  it("releases capacity for malformed JSON, oversized bodies and provider errors", async () => {
    const malformed: FetchLike = async () => new Response("not json");
    const oversized: FetchLike = async () => new Response("{}", { headers: { "content-length": "600000" } });
    const unavailable: FetchLike = async () => new Response("private detail", { status: 503 });
    for (const fetcher of [malformed, oversized, unavailable]) {
      const failures = await Promise.allSettled(Array.from({ length: 8 }, () => fetchWeatherJson(weatherUrl, fetcher)));
      expect(failures.every((result) => result.status === "rejected")).toBe(true);
      await expect(fetchWeatherJson(weatherUrl, success)).resolves.toEqual({ ok: true });
    }
  });

  it("releases an admission slot when the operation throws synchronously", async () => {
    const admit = createUpstreamCapacity(1);
    await expect(admit(() => { throw new Error("Operation failed"); })).rejects.toThrow("Operation failed");
    await expect(admit(async () => "Recovered")).resolves.toBe("Recovered");
  });
});
