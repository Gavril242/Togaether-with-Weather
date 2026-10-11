# Fourcast

I built Fourcast to compare the weather in four places at once. Search a city, choose the correct result, and its forecast, local clock, and sky appear together. Your four place IDs can be saved with your cookie choice.

## Run it

You need Node.js 24 and npm. Weather and place search work without an account, API key, or billing setup.

```sh
git clone https://github.com/Gavril242/Togaether-with-Weather.git
cd Togaether-with-Weather
npm ci
npm run dev -- --port 3100
```

Open <http://127.0.0.1:3100>. Add four places and reload to check that they return. The production site is [fourcast.misaland.me](https://fourcast.misaland.me).

Open Meteo provides geocoding and the factual weather readings. I chose it because it includes both services without a key for this project. The dashboard requests Celsius, km/h, and each place's timezone. [Open Meteo terms](https://open-meteo.com/en/terms).

## Generate the image

Fourcast builds the image prompt on the server from four current Open‑Meteo responses. The prompt names each place and includes its measured conditions; the generated scene is an artistic interpretation, not a factual photo. The app shows the exact prompt beside the image. Requests are off by default and limited to one at a time. Hosted Gemini generation is capped at ten per day and one per visitor every ten minutes; local ComfyUI testing has no cost-based cooldown.

The reviewer path uses Gemini `gemini-3.1-flash-image`: copy `.env.example` to `.env.local`, set `GEMINI_API_KEY` and `IMAGE_GENERATION_ENABLED=true`, then restart the app. Google image generation needs a project with image access; the dashboard works without it. See [Google's current model pricing](https://ai.google.dev/gemini-api/docs/pricing).

For local image testing, I added a ComfyUI provider and an isolated Windows setup for my Radeon RX 9070 XT. The app sends work only to `127.0.0.1`; it does not expose the local model or use it in production. Follow [the local ComfyUI setup](docs/LOCAL_IMAGE_GENERATION.md). SDXL Turbo is licensed for non-commercial use, which is why this is a local development option rather than the hosted reviewer default.

## Weather details

Open‑Meteo supplies the current apparent temperature, humidity, precipitation, cloud cover, pressure, wind direction and gusts, plus daily precipitation chance and total, UV index, sunrise and sunset. Hover or focus a card to preview these details; the “More conditions” control pins them open for touch users. The dashboard still shows the primary values directly without requiring the detail panel.

## What is unfinished

Generated images are returned to the current browser and are not saved. The request limits reset if the server restarts or runs on multiple instances. The security tracker scans the locked dependencies and a fresh ARM64 image; it does not inspect packages already installed on the Pi. The Cloudflare tunnel and HTTPS are live; Cloudflare Access and account-level WAF settings are not configured here.

With one more day, I would add a durable image job and storage path, a real budget shared across restarts, exercise the flow on physical iPhones, and add an external uptime monitor so a Pi or n8n outage is still detected.

## Checks and AI use

```sh
npm run lint
npm run typecheck
npm test
npm run docs:lint
npx playwright install chromium webkit
npm run test:browser
```

I used Codex, GitHub Actions, and official provider documentation. I gave Codex the assignment and the existing app, then reviewed and changed the generated code, tests, and deployment steps. For this part, I asked it to add the local ComfyUI adapter and richer forecast details, then checked the AMD setup against its current ROCm guide and the weather fields against a live Open‑Meteo response. I preserved the AMD PyTorch wheels when ComfyUI's unpinned requirements could have replaced them. Earlier, I replaced an oversized Three.js cloud example with a bounded shader and a static fallback, added server-side weather and image boundaries, and kept image generation opt-in because my Google project has no image quota. I changed search handling after a multiword query exposed an HTML-to-JSON error and added an iPhone-sized Timișoara test. I did not use an AI model to invent weather data or test results.
