import "server-only";
import { locationIdSchema } from "../../domain/locations";
import { ImageProviderError, type GeneratedImage, type ImageProvider } from "../../domain/image";
import type { WeatherSnapshot } from "../../domain/weather";
import { getWeather } from "../weather/service";
import { GeminiImageProvider } from "./gemini";
import { buildWeatherImagePrompt } from "./prompt";

export interface WeatherImageResult {
  image: { data: string; mimeType: GeneratedImage["mimeType"]; width: number; height: number; model: string };
  prompt: { version: string; text: string; locationIds: readonly number[]; observedAt: readonly string[] };
}

export function createWeatherImageService(options: {
  enabled?: boolean;
  apiKey?: string;
  weather?: (id: number) => Promise<{ weather: WeatherSnapshot }>;
  provider?: ImageProvider;
} = {}) {
  return {
    async generate(ids: unknown, signal?: AbortSignal): Promise<WeatherImageResult> {
      if (options.enabled !== true) {
        throw new ImageProviderError("missing_configuration", "Image generation is turned off. Set IMAGE_GENERATION_ENABLED=true and add a server Gemini image key to enable it.", "not_submitted");
      }
      if (!Array.isArray(ids) || ids.length !== 4 || ids.some((id) => !locationIdSchema.safeParse(id).success)
        || new Set(ids).size !== 4) {
        throw new ImageProviderError("invalid_configuration", "Choose four different places before creating an image.", "not_submitted");
      }
      const weather = options.weather ?? getWeather;
      const snapshots = await Promise.all((ids as number[]).map(async (id) => (await weather(id)).weather));
      const prompt = buildWeatherImagePrompt(snapshots);
      const key = options.apiKey ?? process.env.GEMINI_API_KEY;
      const provider = options.provider ?? new GeminiImageProvider({ apiKey: key, model: process.env.GEMINI_IMAGE_MODEL });
      const image = await provider.generate(prompt, signal);
      return {
        image: { data: Buffer.from(image.bytes).toString("base64"), mimeType: image.mimeType,
          width: image.width, height: image.height, model: image.model },
        prompt: { version: prompt.version, text: prompt.text, locationIds: prompt.locationIds, observedAt: prompt.observedAt },
      };
    },
  };
}

const service = createWeatherImageService({
  enabled: process.env.IMAGE_GENERATION_ENABLED === "true",
});

export const generateWeatherImage = service.generate;
