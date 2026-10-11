import "server-only";
import { locationIdSchema } from "../../domain/locations";
import { ImageProviderError, type GeneratedImage, type ImageProvider } from "../../domain/image";
import type { WeatherSnapshot } from "../../domain/weather";
import { getWeather } from "../weather/service";
import { GeminiImageProvider } from "./gemini";
import { ComfyUiImageProvider } from "./comfyui";
import { buildWeatherImagePrompt } from "./prompt";

export interface WeatherImageResult {
  image: { data: string; mimeType: GeneratedImage["mimeType"]; width: number; height: number; model: string };
  selectionLocationIds: readonly number[];
  focusLocationId: number | null;
  prompt: { version: string; text?: string; locationIds: readonly number[]; observedAt: readonly string[] };
}

export function createWeatherImageService(options: {
  enabled?: boolean;
  apiKey?: string;
  weather?: (id: number) => Promise<{ weather: WeatherSnapshot }>;
  provider?: ImageProvider;
} = {}) {
  return {
    async generate(ids: unknown, signal?: AbortSignal, selectedLocationId?: unknown): Promise<WeatherImageResult> {
      if (options.enabled !== true) {
        throw new ImageProviderError("missing_configuration", "Image generation is turned off. Set IMAGE_GENERATION_ENABLED=true in the server environment to enable it.", "not_submitted");
      }
      if (!Array.isArray(ids) || ids.length !== 4 || ids.some((id) => !locationIdSchema.safeParse(id).success)
        || new Set(ids).size !== 4) {
        throw new ImageProviderError("invalid_configuration", "Choose four different places before creating an image.", "not_submitted");
      }
      if (selectedLocationId !== undefined && (!locationIdSchema.safeParse(selectedLocationId).success || !ids.includes(selectedLocationId))) {
        throw new ImageProviderError("invalid_configuration", "Choose a focused place from the four dashboard locations.", "not_submitted");
      }
      const requestedIds = ids as number[];
      const providerName = process.env.IMAGE_PROVIDER ?? "gemini";
      if (providerName !== "gemini" && providerName !== "comfyui") {
        throw new ImageProviderError("invalid_configuration", "IMAGE_PROVIDER must be gemini or comfyui.", "not_submitted");
      }
      if (providerName === "comfyui" && process.env.NODE_ENV === "production") {
        throw new ImageProviderError("invalid_configuration", "The ComfyUI provider is available only for local development. Configure the hosted image provider for production.", "not_submitted");
      }
      const focusLocationId = providerName === "comfyui" ? (selectedLocationId as number | undefined) ?? requestedIds[0]! : null;
      const weather = options.weather ?? getWeather;
      const promptLocationIds = focusLocationId === null ? requestedIds : [focusLocationId];
      const snapshots = await Promise.all(promptLocationIds.map(async (id) => (await weather(id)).weather));
      const prompt = buildWeatherImagePrompt(snapshots);
      const key = options.apiKey ?? process.env.GEMINI_API_KEY;
      const provider = options.provider ?? (providerName === "comfyui"
        ? new ComfyUiImageProvider({ baseUrl: process.env.COMFYUI_API_URL, checkpoint: process.env.COMFYUI_CHECKPOINT })
        : new GeminiImageProvider({ apiKey: key, model: process.env.GEMINI_IMAGE_MODEL }));
      const image = await provider.generate(prompt, signal);
      return {
        image: { data: Buffer.from(image.bytes).toString("base64"), mimeType: image.mimeType,
          width: image.width, height: image.height, model: image.model },
        selectionLocationIds: requestedIds,
        focusLocationId,
        prompt: { version: prompt.version, ...(process.env.NODE_ENV === "production" ? {} : { text: prompt.text }),
          locationIds: prompt.locationIds, observedAt: prompt.observedAt },
      };
    },
  };
}

const service = createWeatherImageService({
  enabled: process.env.IMAGE_GENERATION_ENABLED === "true",
});

export const generateWeatherImage = service.generate;
