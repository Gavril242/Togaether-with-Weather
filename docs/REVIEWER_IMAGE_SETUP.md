# Try image generation locally

Image generation is disabled on the public demo so a visitor cannot spend a project owner's quota. Place search and live weather do not need a key. To try images, run the app locally and configure a provider you control.

## Gemini image API

Create an API key in Google AI Studio for a project with image generation access and available quota. The application uses the image model `gemini-3.1-flash-image`; a text-only Gemini key or text model is not enough. Google may require billing for image access. The app reports provider quota and setup failures without interrupting weather.

From the project folder, copy the example environment file and edit the local copy:

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Set these values in `.env.local`:

```dotenv
GEMINI_API_KEY=your_private_key_here
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
IMAGE_PROVIDER=gemini
IMAGE_GENERATION_ENABLED=true
```

`.env.local` is ignored by Git. Keep the key there; do not use a `NEXT_PUBLIC_` variable, paste it into source code, or commit it. Restart the development server after changing these values:

```sh
npm run dev -- --port 3100
```

Choose four locations, wait for the weather values, and select **Generate image**. The server fetches verified Open‑Meteo observations and builds the prompt itself. The browser never sends an arbitrary prompt or receives the exact prompt text. Hosted Gemini creates a single image from all four places. If the provider returns a quota, billing, or access error, check the model's project quota in Google AI Studio; do not switch to a text model.

## An AI assistant setup request

If you use a coding assistant to help configure your own development environment, you can give it this instruction after cloning the repository and setting your key in the ignored `.env.local` file:

> Read `docs/REVIEWER_IMAGE_SETUP.md`, `docs/PROVIDER.md`, and `.env.example`. Help me enable this repository's existing Gemini image provider locally. Keep my API key only in `.env.local`; never print it, ask me to paste it into chat, add it to source code, expose it to browser JavaScript, or commit it. Confirm that the configured model is an image model and that `IMAGE_GENERATION_ENABLED=true` is read by the running server. Run the existing tests and help me make one local image request only after I choose to do so. Report provider quota or billing errors as-is. Do not fake a successful result, silently change providers, or enable image generation on the public deployment.

## Local GPU option

This repository also includes the author's Windows and Radeon RX 9070 XT ComfyUI experiment. It uses SDXL Turbo at 768 × 512 for one selected city and has lower image quality than the hosted model. Follow [the local ComfyUI guide](LOCAL_IMAGE_GENERATION.md). That guide uses a non-commercial model license for local evaluation; review the license before other use.
