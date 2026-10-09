export const WEATHER_IMAGE_PROMPT_VERSION = "weather-panels-v1";

export interface WeatherImagePrompt {
  version: typeof WEATHER_IMAGE_PROMPT_VERSION;
  text: string;
  locationIds: readonly number[];
  observedAt: readonly string[];
}

export type ImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: ImageMimeType;
  width: number;
  height: number;
  model: string;
  modelVersion?: string;
  responseId?: string;
  usage?: {
    promptTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export type ImageProviderErrorCode =
  | "missing_configuration"
  | "invalid_configuration"
  | "authentication"
  | "quota_exceeded"
  | "refused"
  | "timed_out"
  | "cancelled"
  | "unavailable"
  | "invalid_response";

/** This describes submission certainty, never whether the provider charged. */
export type ImageSubmissionOutcome =
  | "not_submitted"
  | "rejected"
  | "uncertain"
  | "completed";

export class ImageProviderError extends Error {
  readonly automaticRetryAllowed = false;

  constructor(
    readonly code: ImageProviderErrorCode,
    message: string,
    readonly outcome: ImageSubmissionOutcome,
  ) {
    super(message);
    this.name = "ImageProviderError";
  }
}

export interface ImageProvider {
  generate(prompt: WeatherImagePrompt, signal?: AbortSignal): Promise<GeneratedImage>;
}
