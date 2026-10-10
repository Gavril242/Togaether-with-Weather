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

Fourcast builds the image prompt on the server from the four latest weather responses. Gemini `gemini-3.1-flash-image` creates one landscape image; the app shows the exact prompt beside it. The API key stays on the server. Image requests are off by default, limited in memory to one at a time, ten per day for the server, and one per visitor every ten minutes.

Google does not include the selected image model in the Gemini API free tier. I do not have image quota on my project, so I cannot provide a working key or claim a live generated image. To try it, copy `.env.example` to `.env.local`, add a Gemini key whose project has image access, set `IMAGE_GENERATION_ENABLED=true`, and restart the app. The weather dashboard still works without this setup. See [Google's current model pricing](https://ai.google.dev/gemini-api/docs/pricing).

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

I used Codex, GitHub Actions, and official provider documentation. I gave Codex the assignment and the existing app, then reviewed and changed the generated code, tests, and deployment steps. I replaced an oversized Three.js cloud example with a bounded shader and a static fallback, added server-side weather and image boundaries, and kept the image feature opt-in when my account could not generate images. I changed the search handling after a multiword query exposed an HTML-to-JSON error, and added an iPhone-sized touch test for Timișoara. I did not use an AI model to invent weather data or test results.
