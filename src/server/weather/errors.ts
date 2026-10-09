import type { ApiErrorResponse } from "../../domain/weather";

export class WeatherServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "WeatherServiceError";
  }
}

export function invalidInput(message: string): WeatherServiceError {
  return new WeatherServiceError("INVALID_INPUT", message, 400, false);
}

export function invalidProviderResponse(): WeatherServiceError {
  return new WeatherServiceError(
    "UPSTREAM_INVALID_RESPONSE",
    "The weather service returned incomplete data. Please try again shortly.",
    502,
    true,
  );
}

export function errorResponse(error: unknown): Response {
  const known = error instanceof WeatherServiceError
    ? error
    : new WeatherServiceError("INTERNAL_ERROR", "The request could not be completed. Please try again.", 500, true);
  const body: ApiErrorResponse = {
    error: { code: known.code, message: known.message, retryable: known.retryable },
  };
  return Response.json(body, {
    status: known.status,
    headers: { "Cache-Control": "no-store", ...(known.status === 429 ? { "Retry-After": "60" } : {}) },
  });
}
