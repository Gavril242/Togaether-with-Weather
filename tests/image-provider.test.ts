import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageProviderError, type WeatherImagePrompt } from "../src/domain/image";
import { decodeProviderImage, MAX_IMAGE_BYTES } from "../src/server/images/image-bytes";
import { DEFAULT_GEMINI_IMAGE_MODEL, GeminiImageProvider } from "../src/server/images/gemini";

const key = "fixture-server-key";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==";
const prompt: WeatherImagePrompt = {
  version: "weather-panels-v1",
  text: "A fixture weather illustration",
  locationIds: [1, 2, 3, 4],
  observedAt: Array.from({ length: 4 }, () => "2026-10-09T12:00:00.000Z"),
};

function success(parts: unknown[] = [{ inlineData: { mimeType: "image/png", data: png } }]) {
  return {
    candidates: [{ finishReason: "STOP", content: { parts } }],
    responseId: "fixture-response-id",
    modelVersion: "gemini-3.1-flash-image",
    usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 1120, totalTokenCount: 1210 },
  };
}

function providerFor(payload: unknown, status = 200) {
  const transport = vi.fn<typeof fetch>(async () => Response.json(payload, { status }));
  return { provider: new GeminiImageProvider({ apiKey: key }, { fetch: transport }), transport };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Gemini image provider", () => {
  it("uses a fixed image model, server header credential, and one bounded image request", async () => {
    const { provider, transport } = providerFor(success());
    const image = await provider.generate(prompt);
    expect(image).toMatchObject({ mimeType: "image/png", width: 1, height: 1, responseId: "fixture-response-id" });
    expect(Buffer.from(image.bytes).toString("base64")).toBe(png);
    expect(image.usage?.totalTokens).toBe(1210);
    expect(transport).toHaveBeenCalledTimes(1);
    const [endpoint, options] = transport.mock.calls[0]!;
    expect(endpoint).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_IMAGE_MODEL}:generateContent`);
    expect(String(endpoint)).not.toContain(key);
    expect(options?.headers).toMatchObject({ "x-goog-api-key": key });
    expect(options?.redirect).toBe("error");
    expect(options?.cache).toBe("no-store");
    expect(JSON.parse(options?.body as string)).toMatchObject({
      generationConfig: { candidateCount: 1, responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "1K" } },
    });
    expect(JSON.stringify(provider)).not.toContain(key);
  });

  it("rejects missing credentials and text or arbitrary models before any submission", () => {
    expect(() => new GeminiImageProvider({})).toThrowError(expect.objectContaining({ code: "missing_configuration", outcome: "not_submitted" }));
    for (const model of ["gemini-2.5-flash", "https://attacker.invalid/model", "gemini-nano-banana-2.1"]) {
      expect(() => new GeminiImageProvider({ apiKey: key, model })).toThrowError(expect.objectContaining({ code: "invalid_configuration" }));
    }
  });

  it.each([
    [429, "quota_exceeded", "rejected"],
    [401, "authentication", "rejected"],
    [403, "authentication", "rejected"],
    [400, "invalid_configuration", "rejected"],
    [404, "invalid_configuration", "rejected"],
    [500, "unavailable", "uncertain"],
    [504, "timed_out", "uncertain"],
  ])("classifies HTTP %s and never automatically retries", async (status, code, outcome) => {
    const { provider, transport } = providerFor({ error: { message: `Upstream echoed ${key}` } }, Number(status));
    const error = await provider.generate(prompt).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ImageProviderError);
    expect(error).toMatchObject({ code, outcome, automaticRetryAllowed: false });
    expect(String(error)).not.toContain(key);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    { promptFeedback: { blockReason: "SAFETY" } },
    { candidates: [{ finishReason: "IMAGE_SAFETY" }] },
    { candidates: [{ finishReason: "STOP", safetyRatings: [{ blocked: true }] }] },
  ])("classifies explicit provider refusal", async (payload) => {
    const { provider } = providerFor(payload);
    await expect(provider.generate(prompt)).rejects.toMatchObject({ code: "refused" });
  });

  it("ignores intermediate thought images and uses the final image", async () => {
    const { provider } = providerFor(success([
      { thought: true, inlineData: { mimeType: "image/png", data: "invalid intermediate image" } },
      { inlineData: { mimeType: "image/png", data: png } },
    ]));
    await expect(provider.generate(prompt)).resolves.toMatchObject({ width: 1 });
  });

  it.each([
    success([{ text: "Here is your image" }]),
    success([{ fileData: { fileUri: "http://127.0.0.1/private", mimeType: "image/png" } }]),
    success([{ inlineData: { mimeType: "image/svg+xml", data: png } }]),
    success([{ inlineData: { mimeType: "image/png", data: "not-base64" } }]),
    success([{ inlineData: { mimeType: "image/png", data: Buffer.from("not an image").toString("base64") } }]),
    { candidates: [{ finishReason: "NO_IMAGE" }] },
  ])("rejects missing or malformed images without fetching returned URLs", async (payload) => {
    const { provider, transport } = providerFor(payload);
    await expect(provider.generate(prompt)).rejects.toMatchObject({ code: "invalid_response", outcome: "completed" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized declared responses and malformed JSON", async () => {
    for (const response of [
      new Response("{}", { headers: { "Content-Type": "application/json", "Content-Length": String(16 * 1024 * 1024) } }),
      new Response("not JSON", { headers: { "Content-Type": "application/json" } }),
    ]) {
      const transport = vi.fn<typeof fetch>(async () => response);
      const provider = new GeminiImageProvider({ apiKey: key }, { fetch: transport });
      await expect(provider.generate(prompt)).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("bounds a streamed response even without a content length", async () => {
    let reads = 0;
    const response = new Response(new ReadableStream({
      pull(controller) {
        reads += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    }), { headers: { "Content-Type": "application/json" } });
    const transport = vi.fn<typeof fetch>(async () => response);
    const provider = new GeminiImageProvider({ apiKey: key }, { fetch: transport });
    await expect(provider.generate(prompt)).rejects.toMatchObject({ code: "invalid_response" });
    expect(reads).toBeLessThanOrEqual(18);
  });

  it("records an ambiguous timeout and submits only once", async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error(`transport secret ${key}`)), { once: true });
    }));
    const provider = new GeminiImageProvider({ apiKey: key }, { fetch: transport, timeoutMs: 20 });
    const result = expect(provider.generate(prompt)).rejects.toMatchObject({ code: "timed_out", outcome: "uncertain", automaticRetryAllowed: false });
    await vi.advanceTimersByTimeAsync(20);
    await result;
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("distinguishes cancellation before and after submission", async () => {
    const before = new AbortController();
    before.abort();
    const { provider, transport } = providerFor(success());
    await expect(provider.generate(prompt, before.signal)).rejects.toMatchObject({ code: "cancelled", outcome: "not_submitted" });
    expect(transport).not.toHaveBeenCalled();

    const after = new AbortController();
    const pendingTransport = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    }));
    const pendingProvider = new GeminiImageProvider({ apiKey: key }, { fetch: pendingTransport });
    const result = pendingProvider.generate(prompt, after.signal);
    after.abort();
    await expect(result).rejects.toMatchObject({ code: "cancelled", outcome: "uncertain" });
    expect(pendingTransport).toHaveBeenCalledTimes(1);
  });

  it("never exposes transport errors or their credentials", async () => {
    const transport = vi.fn<typeof fetch>(async () => { throw new Error(`URL and secret ${key}`); });
    const provider = new GeminiImageProvider({ apiKey: key }, { fetch: transport });
    const error = await provider.generate(prompt).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "unavailable", outcome: "uncertain" });
    expect(String(error)).not.toContain(key);
  });
});

describe("provider image bounds", () => {
  it("rejects MIME mismatches, noncanonical base64, oversized bytes, and excessive dimensions", () => {
    expect(() => decodeProviderImage(png, "image/jpeg")).toThrow(ImageProviderError);
    expect(() => decodeProviderImage(png + "\n", "image/png")).toThrow(ImageProviderError);
    expect(() => decodeProviderImage("A".repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4), "image/png")).toThrow(ImageProviderError);
    const large = Buffer.from(png, "base64");
    large.writeUInt32BE(100_000, 16);
    expect(() => decodeProviderImage(large.toString("base64"), "image/png")).toThrow(ImageProviderError);
  });
});
