# Togaether with Weather

Fourcast is a dashboard for four places, their weather, local clocks, and an atmospheric sky.

## Run locally

Use Node.js 24 LTS and npm. Development was verified with Node.js 24.21.0.

```sh
git clone https://github.com/Gavril242/Togaether-with-Weather.git
cd Togaether-with-Weather
npm ci
npm run dev -- --port 3100
```

Open <http://127.0.0.1:3100>. No key, environment file, account, or database is required for weather. Search full place names, choose a specific match, add four places, and reload to restore them. The Allow cookies choice saves only location IDs for a year. Until a choice, preferences stay in memory for this tab. You can change the choice from the page footer. Weather readings refresh independently; a gateway HTML page shows a retry message instead of a JSON parser error. Click a weather card to focus its sky. The tab icon follows the Fourcast weather mark.

For a production build, stop the development server and run:

```sh
npm run build
npm run start -- --port 3100
```

## Providers and visuals

Open Meteo supplies place lookup and every weather reading. It provides structured data and timezones without a key for eligible demo use. Celsius and km/h are requested explicitly. The footer links to the provider. Review its [service terms](https://open-meteo.com/en/terms) before public use.

Gemini `gemini-3.1-flash-image` is the selected image provider because it supports image output without a local GPU. Its server adapter requests one 16:9, 1K image. The deterministic prompt builder uses four validated weather snapshots. Credentials stay server side. Optional future configuration is documented in [.env.example](.env.example) and the [provider record](docs/PROVIDER.md).

The Three.js background follows the focused place's local time and conditions. Clouds, rain, snow, fog, a sun haze, and a restrained thunder glow use bounded rendering. Clicking a weather card changes the focused local day and sky. Reduced motion and constrained devices use a static sky. Dawn and dusk are stylized, not calculated sunrise. React Bits SpotlightCard and a small round Blob Cursor variant are adapted with the [license retained](src/components/reactbits/LICENSE.txt). Touch and reduced motion retain native cursors. Hardware performance has not been benchmarked.

## Current limits

Image generation is disabled in this release. The adapter and prompt builder have fixture tests; browser integration, durable jobs, storage, ownership, and spending controls remain to be shipped. Adding an image key does not enable the button. One authorized Gemini image request returned HTTP 429 because the supplied project has no usable image quota. No image was generated.

The app is deployed at <https://fourcast.misaland.me> through its dedicated Cloudflare Tunnel. The tunnel terminates public HTTPS and redirects Cloudflare edge HTTP visits to the canonical HTTPS hostname. n8n checks application health and a canonical weather response every five minutes; it sends outage and recovery email through the existing Resend account to the address configured by the owner. A separate daily security workflow scans the repository and clean runtime image. These checks run on the same Pi and cannot detect loss of Pi power or n8n itself. See [operations](docs/OPERATIONS.md) for release evidence and scope.

## Checks and AI use

```sh
npm run lint
npm run typecheck
npm test
npm run docs:lint
npx playwright install chromium
npm run test:browser
```

Browser tests use a production server on port 3100 and provider fixtures. Keep that port free. Ordinary checks make no paid image calls.

Codex built the app from the assignment and architecture plan. Parallel agents implemented weather adapters, reviewed provider boundaries, built the sky, and tested user flows. Review corrected stale background data, hidden keyboard selection, dependency advisories, and inaccessible control names. The expensive example cloud renderer was replaced with a smaller shader. The multiword search error now handles HTML gateway responses, and the security digest validates evidence per advisory. The complete [development record](docs/AI_USE.md), [delivery plan](docs/DELIVERY_PLAN.md), and [architecture](docs/ARCHITECTURE.md) distinguish shipped behavior from future work.
