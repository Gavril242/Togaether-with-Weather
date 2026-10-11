import "server-only";

import { Buffer } from "node:buffer";
import { randomInt } from "node:crypto";
import { ImageProviderError, type GeneratedImage, type ImageProvider, type WeatherImagePrompt } from "../../domain/image";
import { decodeProviderImage, MAX_IMAGE_BYTES } from "./image-bytes";

const DEFAULT_BASE_URL = "http://127.0.0.1:8188";
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const SDXL_TURBO_MODEL = "sd_xl_turbo_1.0_fp16.safetensors";

type ComfyConfiguration = { baseUrl?: string; checkpoint?: string };
type ComfyOptions = { fetch?: typeof fetch; timeoutMs?: number; pollIntervalMs?: number; seed?: () => number };

function invalidConfiguration(message: string): never {
  throw new ImageProviderError("invalid_configuration", message, "not_submitted");
}

function parseBaseUrl(value: string | undefined): URL {
  let url: URL;
  try { url = new URL(value ?? DEFAULT_BASE_URL); } catch { return invalidConfiguration("COMFYUI_API_URL must be a loopback HTTP URL."); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    return invalidConfiguration("ComfyUI must use a loopback HTTP address such as http://127.0.0.1:8188.");
  }
  url.pathname = "";
  return url;
}

function makeEndpoint(base: URL, path: string): URL {
  return new URL(path, base);
}

async function readBoundedJson(response: Response, maximum = MAX_JSON_BYTES): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if ((Number.isFinite(declared) && declared > maximum)
    || !response.headers.get("content-type")?.toLowerCase().includes("application/json") || !response.body) {
    await response.body?.cancel();
    throw new ImageProviderError("invalid_response", "ComfyUI returned an invalid response.", "completed");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new ImageProviderError("invalid_response", "ComfyUI returned an oversized response.", "completed");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new ImageProviderError("invalid_response", "ComfyUI returned malformed JSON.", "completed"); }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function promptWorkflow(prompt: string, checkpoint: string, seed: number): Record<string, unknown> {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: 768, height: 512, batch_size: 1 } },
    "5": { class_type: "KSampler", inputs: { seed, steps: 4, cfg: 0, sampler_name: "euler", scheduler: "sgm_uniform", denoise: 1, model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0] } },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { filename_prefix: "fourcast-weather", images: ["6", 0] } },
  };
}

async function readImage(response: Response): Promise<GeneratedImage> {
  const declared = Number(response.headers.get("content-length"));
  if ((Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) || !response.headers.get("content-type")?.toLowerCase().startsWith("image/png") || !response.body) {
    await response.body?.cancel();
    throw new ImageProviderError("invalid_response", "ComfyUI returned an invalid image response.", "completed");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new ImageProviderError("invalid_response", "ComfyUI returned an oversized image.", "completed");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const decoded = decodeProviderImage(bytes.toString("base64"), "image/png");
  return { ...decoded, model: SDXL_TURBO_MODEL };
}

/** ComfyUI is intentionally local-only. Generation uses one low-step, bounded SDXL Turbo render. */
export class ComfyUiImageProvider implements ImageProvider {
  private readonly baseUrl: URL;
  private readonly checkpoint: string;
  private readonly transport: typeof fetch;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly seed: () => number;

  constructor(configuration: ComfyConfiguration = {}, options: ComfyOptions = {}) {
    this.baseUrl = parseBaseUrl(configuration.baseUrl);
    this.checkpoint = configuration.checkpoint ?? SDXL_TURBO_MODEL;
    if (!/^[\w.-]{1,120}\.safetensors$/.test(this.checkpoint)) invalidConfiguration("COMFYUI_CHECKPOINT must be a safe .safetensors filename.");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 300_000
      || !Number.isFinite(this.pollIntervalMs) || this.pollIntervalMs < 10 || this.pollIntervalMs > 10_000) {
      invalidConfiguration("ComfyUI timeout or polling interval is invalid.");
    }
    this.transport = options.fetch ?? fetch;
    this.seed = options.seed ?? (() => randomInt(0, 2_147_483_647));
  }

  async generate(prompt: WeatherImagePrompt, signal?: AbortSignal): Promise<GeneratedImage> {
    if (signal?.aborted) throw new ImageProviderError("cancelled", "Image generation was cancelled before submission.", "not_submitted");
    if (!prompt.text.trim() || prompt.text.length > 12_000 || prompt.locationIds.length !== 4) {
      throw new ImageProviderError("invalid_configuration", "The weather image prompt is invalid.", "not_submitted");
    }
    const controller = new AbortController();
    let timedOut = false;
    let submitted = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const request = (path: string) => this.transport(makeEndpoint(this.baseUrl, path), { redirect: "error", cache: "no-store", signal: controller.signal });

    try {
      // Mark the submission uncertain before dispatch: a network failure can happen after ComfyUI accepted it.
      submitted = true;
      const queued = await this.transport(makeEndpoint(this.baseUrl, "/prompt"), {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", redirect: "error", signal: controller.signal,
        body: JSON.stringify({ prompt: promptWorkflow(prompt.text, this.checkpoint, this.seed()) }),
      });
      if (!queued.ok) {
        await queued.body?.cancel();
        if (queued.status === 400) throw new ImageProviderError("invalid_configuration", "ComfyUI rejected the local workflow. Check the SDXL Turbo checkpoint and custom node setup.", "rejected");
        throw new ImageProviderError("unavailable", "ComfyUI could not queue the image. Weather remains available.", "uncertain");
      }
      const queueBody = record(await readBoundedJson(queued));
      if (typeof queueBody?.prompt_id !== "string" || !/^[0-9a-f-]{36}$/i.test(queueBody.prompt_id)) {
        throw new ImageProviderError("invalid_response", "ComfyUI did not return a valid generation ID.", "uncertain");
      }
      const promptId = queueBody.prompt_id;
      const deadline = Date.now() + this.timeoutMs;
      while (Date.now() < deadline) {
        if (signal?.aborted) throw new ImageProviderError("cancelled", "Image generation was interrupted. The local job may still finish.", "uncertain");
        await new Promise<void>((resolve, reject) => {
          const finish = () => { controller.signal.removeEventListener("abort", onAbort); resolve(); };
          const timerId = setTimeout(finish, this.pollIntervalMs);
          const onAbort = () => { clearTimeout(timerId); controller.signal.removeEventListener("abort", onAbort); reject(new Error("aborted")); };
          controller.signal.addEventListener("abort", onAbort, { once: true });
        });
        const history = record(await readBoundedJson(await request(`/history/${promptId}`), MAX_HISTORY_BYTES));
        const run = record(history?.[promptId]);
        if (!run) continue;
        if (record(run.status)?.status_str === "error") {
          throw new ImageProviderError("unavailable", "ComfyUI could not render this image. Check its local console and try again.", "rejected");
        }
        const outputs = record(run.outputs);
        const images = Object.values(outputs ?? {}).flatMap((node) => Array.isArray(record(node)?.images) ? record(node)!.images as unknown[] : []);
        if (images.length > 1) throw new ImageProviderError("invalid_response", "ComfyUI returned an unexpected number of images.", "completed");
        const image = record(images[0]);
        if (!image) continue;
        if (typeof image.filename !== "string" || !/^fourcast-weather_[A-Za-z0-9_-]+\.png$/.test(image.filename)
          || typeof image.subfolder !== "string" || (image.subfolder && !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(image.subfolder))
          || image.type !== "output") {
          throw new ImageProviderError("invalid_response", "ComfyUI returned an unexpected output reference.", "completed");
        }
        const viewUrl = makeEndpoint(this.baseUrl, "/view");
        viewUrl.search = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: "output" }).toString();
        const result = await this.transport(viewUrl, { cache: "no-store", redirect: "error", signal: controller.signal });
        if (!result.ok) {
          await result.body?.cancel();
          throw new ImageProviderError("invalid_response", "ComfyUI could not return its generated image.", "completed");
        }
        return await readImage(result);
      }
      throw new ImageProviderError("timed_out", "ComfyUI did not finish in time. The local job may still complete; it will not be queued again automatically.", "uncertain");
    } catch (error) {
      if (error instanceof ImageProviderError) throw error;
      if (timedOut) throw new ImageProviderError("timed_out", "ComfyUI did not finish in time. Its local job may still complete; it will not be queued again automatically.", submitted ? "uncertain" : "not_submitted");
      if (signal?.aborted) throw new ImageProviderError("cancelled", `Image generation was cancelled${submitted ? " after submission; the local job may still finish" : " before submission"}.`, submitted ? "uncertain" : "not_submitted");
      throw new ImageProviderError("unavailable", "ComfyUI could not be reached. Start it locally and try again.", submitted ? "uncertain" : "not_submitted");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}
