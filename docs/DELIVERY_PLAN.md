# Delivery plan

Status: weather foundation, public safeguards, Pi deployment, consent controls, operations, and the weather experience are shipped, 10 October 2026. Browser image generation remains incomplete because the supplied account has no usable image quota. Durable image jobs, ownership, media storage, and spending controls remain required before public generation.

## Outcome and boundaries

Build one dashboard where a visitor chooses four places, sees real weather and local time for each, and generates one image from an immutable snapshot of their weather. The exact prompt appears beside the image. Failures remain visible and confined to the feature that failed.

Keep this repository separate from the existing recruitment project. Preserve its code and history. The first product release runs locally with no API key for weather. The public weather origin is deployed to the owner's Raspberry Pi 4 with 4 GB RAM; image generation remains disabled.

The Pi already hosts other projects. The owner authorized a separate origin and Cloudflare Tunnel; only this project's files, container, connector, and n8n workflows were changed. Existing projects remain outside this deployment.

## Product requirements

| Area | Behavior required for the first complete release |
| :--- | :--- |
| Search | Search by place name, show country and region, support keyboard selection, and distinguish places with the same name |
| Selection | Permit at most four unique provider locations, allow removal and replacement, and restore selected locations after reload |
| Weather | Show current temperature, conditions, wind, today's maximum and minimum, and local time with explicit °C and km/h units |
| Data | Obtain every weather value from the weather API; use code to map documented condition codes |
| Image | Generate one image that incorporates all four locations in their selected order |
| Prompt | Build the prompt on the server from a saved weather snapshot; show that exact prompt beside its image |
| Recovery | Clearly explain empty search, weather outage, missing provider configuration, refusal, rate limit, and generation timeout |
| Independence | A failed weather card or image request leaves the rest of the dashboard usable |
| Secrets | Read provider credentials from server environment variables; commit an empty configuration example |
| Submission | Provide a public repository, meaningful history, a short honest README, and commands verified from a fresh clone |

The image button requires four valid weather results within the allowed freshness window. A previous image remains associated with its original four locations when the visitor changes the dashboard. The interface identifies that snapshot rather than implying it depicts the new selections.

## Technical decisions

| Decision | Choice and reason |
| :--- | :--- |
| Application | Next.js, React, and TypeScript; one repository with explicit server and browser boundaries |
| Runtime | Node.js 24 LTS, with the same supported runtime in development, CI, and containers |
| Initial package baseline | Next.js 16.4.0 and React 19.3.0 were verified from the npm registry during planning; verify supported patch releases again at implementation |
| Weather and search | Open Meteo; structured responses, place identifiers, timezones, and no credential for eligible demo use |
| Image provider | Gemini behind a server adapter; `gemini-3.1-flash-image`, with successful live output still required for acceptance |
| Composition | One landscape image with four coherent panels in selection order; HTML captions remain readable even if model text rendering varies |
| Durable work | PostgreSQL stores generation jobs, snapshots, ownership, and quota reservations; a separate worker performs slow calls |
| Local setup | Weather runs with npm alone; future image phase adds PostgreSQL, worker, and a verified Docker path |
| Media | Local persistent volume with retention and ownership checks; replace through an S3 storage adapter if needed later |
| Cache | Bounded application cache and request coalescing first; Redis requires measured need |
| Public entry | Supplied Cloudflare Tunnel, a dedicated hostname, and an origin proxy appropriate to the existing tunnel topology |
| Operations | Uptime Kuma for service checks; n8n for approved operations outside the weather and generation request path |

Implementation checks use an isolated, checksum verified Node.js 24.21.0 runtime. The host's unrelated Node installation is unchanged. CI selects Node 24 from `.nvmrc`. The release schedule lists Node.js 24 as LTS. [Node.js releases](https://nodejs.org/en/about/previous-releases)

Gemini model parameters remain server controlled. The selected stable alias supports image output, but the authorized probe returned HTTP 429 for free tier quotas. Successful output, latency, and spending behavior still require verification. See the [provider record](PROVIDER.md) and [Gemini image guide](https://ai.google.dev/gemini-api/docs/image-generation).

Open Meteo's hosted free API has use restrictions, rate limits, and attribution requirements. Confirm that the intended portfolio demo fits the service terms before public launch; use the appropriate subscription if its purpose changes. [Open Meteo terms](https://open-meteo.com/en/terms)

## Delivery sequence

Each phase has its own commits and a reviewable result. Application CI begins with the foundation and grows with the features it can actually verify.

| Phase | What ships | Acceptance gate | Example branch |
| :--- | :--- | :--- | :--- |
| 0. Planning | Public repository, architecture decisions, test strategy, development record, and documentation CI | Documentation checks pass on GitHub; application and deployment status are accurately stated | Initial main history |
| 1. Foundation | Weather app shell, shared contracts, configuration validation, lint, type checking, test harness, and production build | Fresh clone starts; the page works without an image key; CI runs real lint, types, focused tests, and build | `codex/foundation` |
| 2. Locations and weather | Accessible search, four persistent slots, normalized weather, timezone clocks, per card loading and retry | Ambiguous places, duplicates, corrupt storage, reload, replacement, midnight, and one failed card pass browser and API tests | `codex/weather` |
| 3. Image generation | PostgreSQL migrations, worker, immutable prompt and snapshot, job ownership, idempotency, bounded queue, baseline quotas, image display, job restore, local media | All four locations influence one image; the saved prompt matches; admission races, refusal, and uncertain timeout work; one authorized live smoke test passes | `codex/images` |
| 4. Public safeguards | Stronger public quotas, origin checks, server validated abuse challenge, retention, and honest readiness | Abuse and ownership tests pass; database failure blocks new paid jobs; crash and disk pressure recovery are demonstrated | `codex/public-safety` |
| 5. Containers and releases | Nonroot containers, health probes, real vulnerability gates, GHCR image publication, supported architecture builds, release manifests | Images start and pass smoke checks on hosted runners; failing gates prevent publication; manifests record immutable digests | `codex/releases` |
| 6. Usability and performance | Responsive visual polish, React transitions, reduced motion, accessibility review, accurate metadata, measured performance | Keyboard and mobile flows pass; performance reports are retained; no fabricated Lighthouse or deployment claims | `codex/experience` |
| 7. Pi deployment and handover | Isolated Compose project, dedicated supplied tunnel connector, health checks, rollback, and separate n8n alerts | Pi health and public HTTPS probes pass; controlled outage and recovery mail requests are accepted; security feed is verified before scanner alerts activate | `codex/pi-release` |

The current increment ships the weather foundation, cookie preferences, part of the experience phase, and the image provider boundary. Phases 1 through 3 must satisfy all gates to deliver the complete assignment locally. Phase 4 is required before anonymous public paid generation. On 10 October the owner supplied a tunnel token and authorized a weather only Pi deployment. Phase 5 now builds verified ARM64 image archives with manifests rather than publishing to GHCR; this avoids introducing registry credentials on the shared host. The phase 7 connector is online; origin and monitoring evidence belongs in [operations](OPERATIONS.md).

## Phase detail

### 1. Foundation

1. Initialize a focused Next.js application without recruitment, evaluator, sandbox, or unrelated application routes.
2. Define location, normalized weather, image job, and error schemas. Validate both incoming requests and external responses.
3. Add server environment validation and `.env.example` with blank secrets. Missing image configuration disables generation with a clear message while search and weather continue.
4. Establish ESLint through its CLI, strict TypeScript, unit and route tests, and Playwright. Keep scripts reproducible through `npm ci`.
5. Update the short README with commands that are valid for this phase. Record the exact commands executed from a clean checkout.

### 2. Locations and weather

1. Implement a debounced search with cancellation, a result limit, disambiguating country and administrative region, and explicit no result and service failure states.
2. Select canonical provider identifiers. Reject duplicate selections and a fifth location on both client and server boundaries.
3. Store a versioned list in browser storage after hydration. Recover safely from malformed or obsolete values and report storage write failure.
4. Fetch cards independently. Abort obsolete requests and prevent a removed location's response from overwriting its replacement.
5. Normalize current temperature, conditions, wind, daily temperatures, timezone, observation time, and retrieval time. Explicitly request Celsius and km/h.
6. Use timezone aware local clocks and dates. Daily temperature cache validity ends at the location's date change. Display stale values honestly during a bounded outage.
7. Include attribution. Test provider response changes and unknown weather codes without inventing conditions.

### 3. Image generation

1. Keep provider weather authoritative. Browser requests supply four location identifiers and an idempotency key, never their own weather or an arbitrary generation prompt.
2. Resolve the identifiers, capture four complete weather results, and build the exact prompt in code. Store the snapshot, prompt version, provider model, image parameters, and selection order together.
3. Persist a job before returning `202`. The worker claims bounded work from PostgreSQL; the browser polls and restores its active job after reload.
4. Use explicit job states for queued, running, completed, refused, failed, unknown provider outcome, and expired media. Make terminal messages actionable without exposing secrets.
5. Disable automatic retries for paid generation. A provider timeout after submission or a worker crash during submission becomes an unknown outcome and retains its cost reservation.
6. Save validated image bytes on a persistent volume using safe filenames and atomic writes. Preserve job ownership on every status and media request.
7. Exercise a real image call only with authorized credentials and a bounded cost. Record the actual result in the development record; fixtures alone do not prove provider integration.
8. Include anonymous job ownership, idempotency, finite queue capacity, a global attempt cap, and transactional quota and cost reservations in the local image release. Public safeguards refine these controls rather than introducing them after paid calls already exist.
9. Resolve existing idempotent requests before upstream reads and fingerprint the submitted intent rather than changing weather. Require a lease guarded transition before provider dispatch; a stale worker must never submit work after losing ownership.

### 4. Public safeguards

1. Use a secure anonymous session cookie to own jobs. Visitors need no account, but cannot enumerate another visitor's jobs or images.
2. Restrict generation to allowed origins and content types, bound request bodies, and validate challenge tokens on the server for public generation.
3. Reserve global and visitor quotas transactionally before a provider call. Start with one active generation and a small queue. Reject excessive work clearly with `429` and retry guidance.
4. Define a global daily attempt cap, cost reservation cap, and operator kill switch. Treat unknown provider outcomes conservatively. A missing or invalid public budget configuration disables paid submission.
5. Keep the dashboard working during worker, media, or image provider outages. A durable store outage blocks new paid jobs instead of bypassing limits.
6. Set retention and disk limits. Clean orphan media safely and keep active jobs protected from cleanup races.

### 5. Containers and releases

1. Build the web and worker from the same revision. Use locked dependencies, a supported runtime, nonroot execution, bounded logs, and minimal writable directories.
2. Run CI on hosted runners, including production startup smoke tests. Add database migration and worker integration tests before publishing images.
3. Confirm the Pi operating system architecture at the later deployment stage. Build and test ARM64 images remotely if its OS is 64 bit. Do not assume the board model proves the installed OS architecture.
4. Publish GHCR images only after required jobs pass. Attach a revision and immutable image digest to each release, with vulnerability and provenance evidence.
5. Keep pull request workflows separate from publishing credentials. Use explicit permissions, commit pinned actions, timeouts, and concurrency controls.
6. Define a fixed deployment procedure that accepts an approved release manifest. No arbitrary webhook supplied shell command runs on the Pi.

### 6. Usability and performance

1. Use a restrained visual system with clear type hierarchy, intentional spacing, weather icons, and a responsive four card grid. Start with one card per row on narrow screens.
2. Implement an accessible combobox, visible focus, readable units, announced errors, and named remove and retry controls. Manually review the keyboard flow alongside automated checks.
3. Use React's documented ViewTransition behavior for card changes and image reveal where supported by the selected stack. Keep effects brief and provide a functional fallback. Reduced motion must be honored explicitly. [React ViewTransition](https://react.dev/reference/react/ViewTransition)
4. Avoid animation on every clock tick or weather refresh. Animate opacity and transforms without hiding pending work or introducing layout shifts.
5. Reserve image dimensions and use an appropriate display format. Keep provider calls out of initial page rendering and keep prompt details collapsible on small screens.
6. Target Lighthouse scores of at least 95 for the dashboard under documented production build conditions. Store actual reports and address regressions; a score is a measurement, not a decorative badge.
7. Publish accurate English metadata, canonical URLs only when the real hostname is known, and a small sitemap. Private job and media URLs do not belong in indexing.

### 7. Deployment and handover

1. After the owner supplies the tunnel details, inspect OS architecture, available memory and storage, Docker version, existing port allocations, and the tunnel's current operating mode. Read before choosing resource limits.
2. Create dedicated project names, volumes, network names, credentials, and ports. Add only the supplied hostname route and preserve existing tunnel configuration.
3. Keep PostgreSQL and any later cache service off public and LAN ports. Expose only the intended origin to the tunnel path. Scope every service change to this project.
4. Deploy an immutable release digest, verify database migration compatibility, start the worker, and run local and external probes. A migration failure leaves the previous release available.
5. Exercise rollback with the previous image and a compatible schema. Use additive migrations first; destructive migration requires a separately reviewed plan and backup.
6. Configure bounded log retention, actual readiness, worker heartbeat, media disk alerts, scheduled backups, and a restore test into an isolated target.
7. Keep n8n outside the request path. Optional operations hooks require authenticated, replay protected requests and a fixed deployment or backup script. Notifications need the owner's explicit destination and instruction.
8. Use an external monitor for full Pi or network failure; a monitor on the same Pi cannot observe every outage. Document recovery steps and residual single host limitations.

## Infrastructure adoption rules

| Technology | Initial role | Condition for expanding it |
| :--- | :--- | :--- |
| PostgreSQL | Durable jobs, snapshots, metadata, and quotas | Add indexes from actual queries, enforce pool limits, and measure before tuning |
| Redis | Deferred | Multiple web instances, measured cache pressure, or demonstrated distributed coordination needs |
| XFetch | Deferred | Measured refresh stampedes persist after coalescing, bounded stale reads, and expiry jitter |
| Nginx | Proposed origin proxy for limits and routing | Confirm existing topology; microcache only measured, explicitly public GET endpoints |
| S3 or R2 | Storage adapter planned; initial media on a persistent volume | Local durability, capacity, or distribution requirements justify remote storage |
| Presigned media | Deferred until object storage | Authorize the owning session first, issue short lived GET access, and prevent caching of signed responses |
| DNS and Anycast | Use Cloudflare's supplied hostname and tunnel routing | No custom DNS infrastructure needed for this single application |
| Cloudflare Access | Protect operations and optionally private evaluator generation | Match the owner's intended audience; keep the main weather page public if desired |
| Uptime Kuma | Real HTTP and worker checks at deployment | Add an independent external probe for host or connectivity failure |
| n8n | Optional operations orchestration | Approved hooks must not become a dependency for dashboard availability |

## Review and history

1. Commit working increments with messages describing real changes. Preserve implementation history rather than inventing successful intermediate states.
2. Use a pull request per phase where it helps review. The description states what changed, evidence, and known limits.
3. Link each release to its tested commit. CI status must correspond to that commit, including the final container that will be deployed.
4. Keep the README short. Longer operational instructions belong in dedicated documents, linked from it.
5. Record which AI tools did which work, what was reviewed or rewritten, and suggestions rejected. Do not claim manual authorship for generated code.

## Inputs needed later

| Input | Stage that needs it |
| :--- | :--- |
| Authorized image key and account access | Live provider acceptance in phase 3 |
| Allowed image quality and maximum spend | Public budget defaults in phase 4 |
| Pi OS architecture, current capacity, and storage medium | Resource sizing and architecture gate in phase 7 |
| Cloudflare hostname and tunnel integration details | Deployment in phase 7 |
| Whether generation is anonymous public or invited only | Final abuse and Access policy before public exposure |
| Desired operational notification destination | Optional notifications after explicit instruction |

Planning can proceed without those inputs. Their dependent actions remain deferred until the information and authorization exist.

## Initial configuration contract

Only the Gemini settings and disabled image flag are present in `.env.example` today. The adapter validates its explicit constructor configuration, but the application does not instantiate it yet. The other names below are future configuration contracts. Blank secrets are required in committed examples.

| Configuration | Intended behavior |
| :--- | :--- |
| `GEMINI_API_KEY` | Server and worker secret; generation unavailable when absent |
| `GEMINI_IMAGE_MODEL` | Server allowlist; adapter currently fixes 16:9 and 1K rather than accepting browser settings |
| `DATABASE_URL` | Project database credential; required for durable image jobs |
| `APP_ORIGIN` | Exact local or public origin used by state changing request checks |
| `SESSION_SECRET` | Server secret with validated length and rotation policy |
| `GENERATION_MAX_ACTIVE`, `GENERATION_MAX_QUEUED` | Finite global capacity with one active generation initially |
| `GENERATION_DAILY_LIMIT`, `GENERATION_DAILY_BUDGET` | Durable admission caps; paid public submission disabled if invalid |
| `IMAGE_GENERATION_ENABLED` | Future admission switch; currently false, no active generation route |
| `MEDIA_DIRECTORY`, `MEDIA_MAX_BYTES`, `MEDIA_RETENTION_DAYS` | Bounded persistent media storage and retention |
| `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Private verification secret and intentionally public widget identifier |
| `WEATHER_API_BASE_URL` | Server controlled free or subscribed provider endpoint |

No secret uses a `NEXT_PUBLIC_` name. The Turnstile site key is an intentionally public identifier. Docker build context and release artifacts must exclude all environment files containing real values. Deployment supplies secrets at runtime.
