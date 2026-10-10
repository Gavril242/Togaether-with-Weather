import { ImageProviderError } from "../../../domain/image";
import { locationIdSchema } from "../../../domain/locations";
import { errorResponse, invalidInput, WeatherServiceError } from "../../../server/weather/errors";
import { beginImageRequest } from "../../../server/operations/image-budget";
import { generateWeatherImage } from "../../../server/images/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statuses: Record<ImageProviderError["code"], number> = {
  missing_configuration: 503, invalid_configuration: 400, authentication: 403,
  quota_exceeded: 429, refused: 422, timed_out: 504, cancelled: 499,
  unavailable: 503, invalid_response: 502,
};

export async function POST(request: Request): Promise<Response> {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw invalidInput("Send the image request as JSON.");
    }
    const body = await request.text();
    if (body.length > 8_192) throw invalidInput("The image request is too large.");
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw invalidInput("The image request is invalid."); }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
      || !Object.hasOwn(parsed, "locationIds") || Object.keys(parsed).some((key) => key !== "locationIds")) {
      throw invalidInput("The image request is invalid.");
    }
    const locationIds = (parsed as { locationIds?: unknown }).locationIds;
    if (!Array.isArray(locationIds) || locationIds.length !== 4
      || locationIds.some((id) => !locationIdSchema.safeParse(id).success)
      || new Set(locationIds).size !== 4) throw invalidInput("Choose four different places before creating an image.");
    if (process.env.IMAGE_GENERATION_ENABLED !== "true" || !process.env.GEMINI_API_KEY?.trim()) {
      throw new ImageProviderError("missing_configuration", "Image generation is turned off. Add a Gemini image key and set IMAGE_GENERATION_ENABLED=true in the server environment.", "not_submitted");
    }
    const release = beginImageRequest(request);
    try {
      const result = await generateWeatherImage(locationIds, request.signal);
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } finally {
      release();
    }
  } catch (error) {
    if (error instanceof ImageProviderError) {
      return Response.json({ error: { code: error.code.toUpperCase(), message: error.message,
        retryable: error.code === "unavailable" || error.code === "timed_out" } }, {
        status: statuses[error.code], headers: { "Cache-Control": "no-store" },
      });
    }
    if (error instanceof WeatherServiceError) return errorResponse(error);
    return errorResponse(error);
  }
}
