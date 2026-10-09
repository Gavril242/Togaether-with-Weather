# Image provider

Status: 9 October 2026. Gemini is the selected image provider. The server adapter and prompt builder have fixture tests. Durable generation jobs, storage, accounting, and browser generation are the next delivery phase. No image result is fabricated while that integration is unavailable.

## 1. Model and request

The configured model is `gemini-3.1-flash-image`, also called Nano Banana 2. Google lists this stable model as supporting image and text output. It suits one modest dashboard image without a local GPU. The identifier is pinned in application configuration, but it is a provider stable alias rather than an immutable model snapshot. The adapter records the returned model version when supplied. [Official model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image).

The adapter uses native `fetch` against Google's fixed `v1beta/models/{model}:generateContent` endpoint. Server settings request one candidate, image output, a 16:9 composition, and 1K resolution. Redirects are rejected. Google documents these generation configuration fields in its [REST reference](https://ai.google.dev/api/generate-content). The newer image guide prefers the Interactions API; this integration still needs a successful live result before generation is described as working. [Image generation guide](https://ai.google.dev/gemini-api/docs/image-generation).

Only `gemini-3.1-flash-image` is allowlisted. Text models never stand in for image models. A later model change needs updated fixtures, an explicit configuration change, and a successful authorized smoke test. No search grounding or model generated weather is involved.

## 2. Credential and quota

Set `GEMINI_API_KEY` in the server environment or ignored `.env.local`. Set `GEMINI_IMAGE_MODEL=gemini-3.1-flash-image`. The example environment file has a blank credential. Provider code imports `server-only`; the key travels in the `x-goog-api-key` header and never in a browser request, URL, prompt, or fixture. Upstream exception text and error bodies are discarded.

The owner's supplied AI Studio table reports zero request capacity for every listed image model. A working text quota does not establish image access. Google applies limits per project and model, and exposes active account limits in AI Studio. [Quota documentation](https://ai.google.dev/gemini-api/docs/rate-limits).

Verification on 9 October 2026: a server request to list models returned HTTP 200, confirming the supplied credential works. The listing included `gemini-3.1-flash-image` with `generateContent` support. One bounded live image request using 16:9, 1K, and image output returned HTTP 429 `RESOURCE_EXHAUSTED`, citing free tier request and input token quotas. No image was created and the request was not retried. A model listing does not confirm usable generation quota. Successful image generation remains blocked by the provider account capacity.

The weather dashboard remains usable when image configuration or account capacity is unavailable. No automatic fallback spends money through another model or provider.

## 3. Prompt and failure contracts

`buildWeatherImagePrompt` requires four distinct validated snapshots in dashboard order. It copies observations into bounded JSON and assigns top left, top right, bottom left, and bottom right panels. It describes real conditions, Celsius temperature, wind in km/h, daily range, and observation time in the location's timezone. Place names remain data. The prompt is a deterministic function of the snapshots and version, with no text model call.

Persist the exact prompt and snapshots with each future job. Display that saved prompt beside its image. A preview made from today's cards must not replace an older image's prompt.

| Adapter code | Meaning |
| :--- | :--- |
| `missing_configuration` | No server credential; no request submitted |
| `invalid_configuration` | Unsupported model, settings, or prompt |
| `authentication` | Credential, restrictions, or access rejected |
| `quota_exceeded` | Provider returned HTTP 429 |
| `refused` | Explicit provider prompt or candidate block |
| `timed_out` | Deadline expired or provider returned a timeout; outcome may be uncertain |
| `cancelled` | Caller interrupted; certainty depends on submission stage |
| `unavailable` | Network or provider failure |
| `invalid_response` | Missing, malformed, multiple, or unsupported final images |

Each call submits once, with a 120 second deadline covering response reading. Timeout, connection loss, and server errors can follow a processed request. The adapter forbids automatic retries. Submission certainty is not evidence that a charge occurred or did not occur; the future accounting service must preserve uncertain reservations.

JSON responses are bounded to 15 MiB; decoded images to 10 MiB, 4096 pixels per side, and 16 million pixels. PNG, JPEG, and WebP signatures and declared dimensions are checked. Intermediate thought images and arbitrary file URLs are never used. These are header checks, not full pixel decoding. The storage and transformation phase must add decoder validation before transforming image data.

## 4. Verification

CI uses fake transports only. Tests cover deterministic prompt content, duplicate and incomplete snapshots, model restrictions, server credential placement, quota, refusal, timeout, cancellation, malformed responses, oversized streams, and image bounds. They make no paid API calls.

A live verification must use the same server adapter, record only sanitized outcome and settings, and avoid automatic repeats after refusal, quota failure, or uncertain submission. Public admission remains disabled until durable jobs, ownership, spending reservations, storage limits, and recovery tests ship.
