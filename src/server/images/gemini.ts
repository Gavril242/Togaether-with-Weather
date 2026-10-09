import "server-only";

import {
  ImageProviderError,
  type GeneratedImage,
  type ImageProvider,
  type WeatherImagePrompt,
} from "../../domain/image";
import { decodeProviderImage } from "./image-bytes";

export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
export const SUPPORTED_GEMINI_IMAGE_MODELS = [DEFAULT_GEMINI_IMAGE_MODEL] as const;
export const GEMINI_IMAGE_SETTINGS = { aspectRatio: "16:9", imageSize: "1K" } as const;
const MAX_RESPONSE_BYTES = 15 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const REFUSAL_REASONS = new Set([
  "SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII",
  "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "IMAGE_RECITATION", "ESCALATION",
  "PUP_LIMITED_DISABLED",
]);

export interface GeminiImageConfiguration {
  apiKey?: string;
  model?: string;
}

interface GeminiImageOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9._/-]{1,200}$/.test(value)
    ? value
    : undefined;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function invalidResponse(message = "The image provider did not return a usable image."): never {
  throw new ImageProviderError("invalid_response", message, "completed");
}

async function boundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (
    (declaredLength !== null && Number(declaredLength) > MAX_RESPONSE_BYTES) ||
    !response.headers.get("content-type")?.toLowerCase().startsWith("application/json") ||
    !response.body
  ) {
    await response.body?.cancel();
    return invalidResponse("The image provider returned an unsupported response.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return invalidResponse("The image provider returned a response that is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return invalidResponse("The image provider returned malformed data.");
  }
}

function rejectHttp(status: number): never {
  if (status === 429) {
    throw new ImageProviderError(
      "quota_exceeded",
      "Image generation has reached the Gemini project's quota. Check the image model quota in Google AI Studio.",
      "rejected",
    );
  }
  if (status === 401 || status === 403) {
    throw new ImageProviderError(
      "authentication",
      "Gemini image access is unavailable. Check the server credential, API restrictions, and model access.",
      "rejected",
    );
  }
  if (status === 400 || status === 404) {
    throw new ImageProviderError(
      "invalid_configuration",
      "Gemini rejected the configured image model or image request settings.",
      "rejected",
    );
  }
  if (status === 408 || status === 504) {
    throw new ImageProviderError(
      "timed_out",
      "Gemini did not finish in time. The request may have been processed; it will not be resubmitted automatically.",
      "uncertain",
    );
  }
  throw new ImageProviderError(
    "unavailable",
    "The image provider is unavailable. Weather remains available.",
    status >= 500 || (status >= 300 && status < 400) ? "uncertain" : "rejected",
  );
}

function parseImage(payload: unknown, model: string): GeneratedImage {
  const result = object(payload);
  if (!result) return invalidResponse();
  const feedback = object(result.promptFeedback);
  if (
    typeof feedback?.blockReason === "string" &&
    feedback.blockReason !== "BLOCK_REASON_UNSPECIFIED"
  ) {
    throw new ImageProviderError(
      "refused",
      "Gemini declined this image request. The weather dashboard remains available.",
      "rejected",
    );
  }
  if (!Array.isArray(result.candidates) || result.candidates.length !== 1) {
    return invalidResponse();
  }
  const candidate = object(result.candidates[0]);
  const ratings = candidate?.safetyRatings;
  if (
    (typeof candidate?.finishReason === "string" && REFUSAL_REASONS.has(candidate.finishReason)) ||
    (Array.isArray(ratings) && ratings.some((rating) => object(rating)?.blocked === true))
  ) {
    throw new ImageProviderError(
      "refused",
      "Gemini declined to return this image. The weather dashboard remains available.",
      "completed",
    );
  }
  if (candidate?.finishReason !== "STOP") return invalidResponse();
  const content = object(candidate.content);
  if (!Array.isArray(content?.parts)) return invalidResponse();
  const images = content.parts
    .map(object)
    .filter((part) => part?.thought !== true && object(part?.inlineData))
    .map((part) => object(part?.inlineData));
  if (images.length !== 1) return invalidResponse();
  const image = decodeProviderImage(images[0]?.data, images[0]?.mimeType);
  const usage = object(result.usageMetadata);
  return {
    ...image,
    model,
    modelVersion: metadataString(result.modelVersion),
    responseId: metadataString(result.responseId),
    usage: usage ? {
      promptTokens: tokenCount(usage.promptTokenCount),
      outputTokens: tokenCount(usage.candidatesTokenCount),
      totalTokens: tokenCount(usage.totalTokenCount),
    } : undefined,
  };
}

/** One submission only. Durable admission, accounting, and storage belong to the worker. */
export class GeminiImageProvider implements ImageProvider {
  readonly model: typeof DEFAULT_GEMINI_IMAGE_MODEL;
  readonly #apiKey: string;
  private readonly transport: typeof fetch;
  private readonly timeoutMs: number;

  constructor(configuration: GeminiImageConfiguration, options: GeminiImageOptions = {}) {
    const key = configuration.apiKey?.trim();
    if (!key) {
      throw new ImageProviderError(
        "missing_configuration",
        "Image generation is not configured. Add GEMINI_API_KEY to the server environment.",
        "not_submitted",
      );
    }
    if (key.length > 512 || /\s|[\p{Cc}\p{Cf}]/u.test(key)) {
      throw new ImageProviderError(
        "invalid_configuration", "The server Gemini credential is invalid.", "not_submitted",
      );
    }
    const model = configuration.model ?? DEFAULT_GEMINI_IMAGE_MODEL;
    if (!SUPPORTED_GEMINI_IMAGE_MODELS.some((supported) => supported === model)) {
      throw new ImageProviderError(
        "invalid_configuration",
        "The server image model is unsupported. Configure GEMINI_IMAGE_MODEL with an allowed image model.",
        "not_submitted",
      );
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
      throw new ImageProviderError(
        "invalid_configuration", "The image provider timeout is invalid.", "not_submitted",
      );
    }
    this.#apiKey = key;
    this.model = model as typeof DEFAULT_GEMINI_IMAGE_MODEL;
    this.transport = options.fetch ?? fetch;
    this.timeoutMs = timeoutMs;
  }

  async generate(prompt: WeatherImagePrompt, signal?: AbortSignal): Promise<GeneratedImage> {
    if (signal?.aborted) {
      throw new ImageProviderError("cancelled", "Image generation was cancelled before submission.", "not_submitted");
    }
    if (!prompt.text.trim() || prompt.text.length > 12_000 || prompt.locationIds.length !== 4) {
      throw new ImageProviderError("invalid_configuration", "The weather image prompt is invalid.", "not_submitted");
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });

    try {
      const response = await this.transport(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": this.#apiKey },
          redirect: "error",
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt.text }] }],
            generationConfig: {
              candidateCount: 1,
              responseModalities: ["IMAGE"],
              imageConfig: GEMINI_IMAGE_SETTINGS,
            },
          }),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        return rejectHttp(response.status);
      }
      return parseImage(await boundedJson(response), this.model);
    } catch (error) {
      if (error instanceof ImageProviderError) throw error;
      if (timedOut) {
        throw new ImageProviderError(
          "timed_out",
          "Gemini did not finish in time. The request may have been processed; it will not be resubmitted automatically.",
          "uncertain",
        );
      }
      if (signal?.aborted) {
        throw new ImageProviderError(
          "cancelled",
          "Image generation was interrupted after submission. Its outcome is uncertain.",
          "uncertain",
        );
      }
      // Do not retain or expose upstream errors: these may contain request credentials.
      throw new ImageProviderError(
        "unavailable",
        "The image provider could not be reached. Its outcome is uncertain; it will not be resubmitted automatically.",
        "uncertain",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}
