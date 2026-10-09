# Togaether with Weather

A weather dashboard for four places, with one AI image built from their weather.

## Status

This repository currently contains the implementation plan and documentation checks. The application has not been built yet. No deployment has been performed.

Read the [delivery plan](docs/DELIVERY_PLAN.md), [architecture](docs/ARCHITECTURE.md), and [verification strategy](docs/VERIFICATION.md).

## Check this planning release

Use Node.js 24 LTS and npm.

```sh
git clone https://github.com/Gavril242/Togaether-with-Weather.git
cd Togaether-with-Weather
npm ci
npm run docs:lint
```

The application release will document exact commands for local development and Docker, including its image provider configuration. Those commands will be tested from a fresh clone before that release.

## Proposed providers

Open Meteo supplies geocoding and weather. Its structured data supports place disambiguation, current conditions, daily temperatures, and timezones. The public demo must include attribution and comply with the provider's service terms.

OpenAI supplies image generation through a server adapter. The proposed model is `gpt-image-2.5-flare-2026-09-08`, subject to an actual account access and output quality check. Weather values and the displayed prompt are constructed in code. Keys will stay on the server.

## Remaining work

Location search, weather cards, generated images, application tests, production containers, and deployment are planned. The first release must satisfy the complete assignment, including durable image jobs. A later public release adds abuse protection, stricter spending limits, backups, monitoring, and tested rollback.

With one additional day after the working local release, the priority is restart recovery and protection for paid generation, followed by browser failure tests and accessibility verification.

## AI use

Codex inspected the existing project, checked its tests and workflows, researched official documentation, and drafted this plan. Parallel agents reviewed frontend behavior, backend boundaries, and infrastructure. No existing application code was copied into this repository. Unsupported deployment and performance claims from the old project were excluded. Future implementation commits will record AI contributions and the changes made after review in [the development record](docs/AI_USE.md).
