# Verification strategy

## Current evidence

The application is not implemented. No weather, image, browser, accessibility, database, or deployment tests have run in this repository.

Phase 0 introduces Markdown linting, commit whitespace checks, and a documentation dependency audit as the first GitHub workflow. A passing check proves only those planning repository checks passed.

The target application stack is Next.js 16.4, React 19.3, and Node.js 24. Application test commands will be documented after their scripts exist and have been verified.

## Acceptance table

| Requirement | Acceptance evidence | First release gate |
| :--- | :--- | :--- |
| Find a place | A real provider adapter and fixture tests return selectable matches with country and region. | Location phase |
| Resolve ambiguity | Selecting a specific Springfield stores its provider ID and coordinates. | Location phase |
| Keep four places | Four selections survive reload; a fifth cannot replace a place silently. | Location phase |
| Remove and replace | Removing a place frees one slot; pending responses cannot restore it. | Location phase |
| Show weather | Each card shows API sourced temperature, conditions, wind, high, low, and units. | Weather phase |
| Show local time | Injected clock tests cover date boundaries, DST, and fractional timezone offsets. | Weather phase |
| Preserve partial success | An upstream failure affects its card while other cards remain usable. | Weather phase |
| Generate one image | A provider adapter receives a prompt built from four validated weather records. | Image phase |
| Show the exact prompt | Displayed prompt and stored generation snapshot match the submitted request. | Image phase |
| Explain image failures | Refusal, unavailable configuration, rate limit, and uncertain timeout have distinct messages. | Image phase |
| Protect public generation | Concurrent requests respect ownership, idempotency, capacity, and spending limits. | Public release |
| Recover operations | Restart, disk failure, backup restore, and rollback drills produce recorded evidence. | Deployment release |

## Unit tests

1. Validate location and weather contracts at untrusted boundaries. Cover missing fields, unexpected types, invalid coordinates, invalid timezones, nonfinite numbers, and malformed provider responses.
2. Map every supported WMO condition code to its documented label. An unknown code produces an explicit fallback, never an invented condition. Zero and negative temperatures remain valid values.
3. Build prompts from a fixed ordered snapshot of four distinct locations. Verify each location, condition, temperature, wind, units, timezone, and capture time is represented according to the prompt contract.
4. Version prompt fixtures. Assert deterministic output for identical snapshots and intentional differences when weather changes. A prompt fixture must not hide a change to the actual provider request.
5. Exercise clock and date helpers with an injected instant. Cover Europe/Bucharest and America/New_York DST transitions, Asia/Kolkata, Asia/Kathmandu, UTC midnight, and opposite sides of the date line.
6. Test cache freshness, maximum stale age, bounded entries, request coalescing, and local date rollover. Yesterday's high and low must not be labelled as today's after local midnight.
7. Test generation state transitions, lease expiry, attempt limits, idempotency fingerprints, and structured error mapping without contacting an image provider.

## Route and provider tests

1. Use intercepted HTTP fixtures for geocoding, weather, and image adapters. Include successful responses, empty search results, HTTP 429, HTTP 500, malformed JSON, missing values, refusal, and connection timeout.
2. Confirm the server canonicalizes location IDs. Altered browser coordinates, temperatures, prompts, or arbitrary upstream URLs cannot become authoritative provider input.
3. Reject invalid JSON, oversized payloads, duplicate locations, fewer or more than four generation locations, unsupported media types, and invalid request fields with documented error responses.
4. Assert provider keys stay in server configuration. Responses, browser bundles, logs, generated artifacts, and fixture recordings contain no credentials.
5. Exercise one failing weather request alongside three successes. Each successful result remains available; the failed result carries its own error and retry information.
6. Assert outbound deadlines and cancellation are propagated. Late responses from an earlier query or a removed location cannot overwrite the latest dashboard state.
7. Freeze the four weather records before generation. Later card refreshes cannot mutate the stored prompt, snapshot, image metadata, or the image's capture time.
8. Test same origin protections and anonymous job ownership. Another browser session receives HTTP 404 for both job metadata and media, including when the object exists.
9. Verify sensitive job responses are not shared through public cache headers. Media lookup must enforce ownership before returning bytes or a temporary storage link.
10. Confirm uncertain provider timeouts retain a distinct outcome. The route must not imply that no image was created or that the provider did not charge.

## PostgreSQL integration tests

These tests start when durable jobs are introduced. Use an isolated database and apply real migrations. Mock the provider transport, not the database transaction boundaries.

1. Concurrent submissions with the same owner and idempotency key create one job. Reusing that key with a different intent is rejected. Retries return the saved job despite changed weather, server defaults, or an upstream outage. Different owners cannot inspect each other's jobs.
2. Race requests against the same capacity and spending limits. Atomic reservations prevent oversubscription; refused requests do not enter the provider dispatch path.
3. Keep uncertain attempts accounted for until their outcome is reconciled. A timeout must not automatically release a reservation that permits another paid attempt.
4. Claim jobs concurrently with multiple workers. Only one active lease owns a dispatch; expired leases and attempt limits cannot create an unlimited replay loop. Pause one worker until its lease is reclaimed, then resume it and prove its guarded transition prevents a provider call.
5. Crash a worker before dispatch, during dispatch, and after receiving a provider response. Recover safe work and mark ambiguous work for reconciliation without a blind retry.
6. Restart the application and worker with queued and completed jobs present. Durable metadata, ownership, and immutable prompts survive the restart.
7. Simulate database unavailability, cache unavailability, and a transaction failure. Verify the documented fallback policy and prevent untracked provider calls.
8. Enforce expiry and cleanup with an injected clock. Expired media becomes unavailable, and cleanup does not remove another session's active job.
9. Replay generation requests and any signed operational webhook. Deduplication and timestamp or nonce checks prevent repeated effects.
10. Verify migration compatibility with the previously released application image before marking a release eligible for rollback.

## Browser and accessibility tests

Use Playwright with controlled provider responses. Browser tests should exercise the delivered UI and route behavior, not replace every route with a fake success.

1. Search for Springfield, choose a specific match, and confirm the card identifies its country and region. Exercise an unknown place and a provider search outage.
2. Fill all four slots, reload, remove one, and select a replacement. Confirm duplicates and fifth selections receive clear feedback without losing stored places.
3. Load corrupt, outdated, and partially valid browser storage. Recover according to the storage migration policy. Simulate unavailable storage and quota failure without crashing the page.
4. Type quickly, replace a query, and resolve responses in reverse order. Confirm cancelled and stale search results cannot replace current results.
5. Remove a place while its weather loads, then add another. The old response cannot populate the replacement card. Test independent retries during a partial outage.
6. Verify all weather fields and visible units against controlled fixtures. Advance the clock across a location's midnight and both DST transitions without changing other locations incorrectly.
7. Generate with four successful locations. Confirm the image and exact prompt appear together. Refresh weather during generation and confirm the displayed generation snapshot remains unchanged.
8. Exercise refusal, rate limit, unavailable provider configuration, timeout, and storage failure. The dashboard remains usable and retry behavior follows the known job state.
9. Reload during a durable generation job. Resume status polling, show completed output when available, and do not dispatch a duplicate image request.
10. Test keyboard selection, focus movement, removal confirmation where applicable, error announcements, accessible names, and status messages with a screen reader compatible structure.
11. Run automated accessibility checks on empty, searching, loaded, error, and generating states. Manually verify keyboard order, contrast, zoom, and screen reader feedback before release.
12. Verify narrow and wide layouts, long place names, touch targets, and reduced motion. Animations must not hide weather values or block a user action.

## Failure and recovery drills

1. Fill the media volume during an image write. Fail clearly, keep job state truthful, and clean partial files without publishing an incomplete image.
2. Stop a worker while it holds a lease. Confirm safe restart behavior and that uncertain provider work remains protected against duplicate dispatch.
3. Restore database and media backups into an isolated environment. Verify a completed job, its prompt, its owner, and its image together. Record backup age and the observed restore duration.
4. Roll back to the previous immutable container digest against the release schema. Verify location search, weather, existing media, and job recovery before publishing the rollback procedure.
5. Test resource limits on the confirmed Pi model and operating system. Record observed memory, storage, and concurrency behavior before choosing production limits.

## GitHub workflow progression

1. Phase 0 checks documentation quality and its dependency advisories only. Its check name and summary must not suggest that application functionality has been tested.
2. Phase 1 adds dependency installation from the lockfile, linting, type checking, meaningful unit tests, and a production build when the application scripts exist.
3. Add route and adapter tests when those boundaries exist. Ordinary pull request checks use sanitized fixtures and make no paid provider calls.
4. Add isolated PostgreSQL integration jobs when durable persistence exists. Run migrations against a fresh database and retain failure diagnostics without exposing submitted data or secrets.
5. Add browser and accessibility jobs when the application can run in CI. Retain screenshots, traces, and reports with bounded retention; inspect them for sensitive content.
6. Pin every action to a verified commit SHA and use the minimum permissions per job. Default to read only repository contents. Grant package publishing permissions only to the release job.
7. Run public and fork pull requests on GitHub hosted runners without provider keys or deployment secrets. Never execute public pull request code on the shared Raspberry Pi.
8. Build the confirmed Pi architecture on an appropriate hosted runner after its operating system and CPU architecture are known. Do not assume ARM64 until that check is complete.
9. Publish release images to GHCR from a protected trusted branch or release tag. Record the immutable digest, source commit, scan results, and build provenance; deploy by digest.
10. Add deployment only after the owner supplies tunnel details and authorizes that phase. Deployment must preserve existing Pi services and support a tested rollback.

## Live provider smoke test

A live image test is separate from ordinary CI and requires explicit authorization because it can spend money. It must be runnable independently of pull request workflows.

Record the source commit, provider, model identifier, output settings, four location IDs, weather capture times, prompt version, elapsed duration, provider request ID if supplied, result, and any available usage information. Omit credentials and redact sensitive provider metadata.

Inspect the actual image and confirm the stored prompt is the exact submitted prompt. Record refusal or timeout honestly. If a timeout leaves the outcome unknown, do not automatically repeat the call.

## Release checklist

1. Update the README to describe implemented behavior, actual setup commands, configured providers, and remaining limitations.
2. Verify setup from a fresh clone with the documented runtime and committed lockfile. Record which commands ran and their results.
3. Confirm every acceptance row required for this release has linked evidence. Planned tests do not count as passing tests.
4. Run the relevant lint, type, unit, route, integration, browser, and build checks that exist for the phase. Explain skipped checks and failures.
5. Scan tracked files and release artifacts for secrets. Confirm the environment example contains placeholders and the browser receives no server credentials.
6. Record manual accessibility findings and the exact states reviewed. Do not infer accessibility from an automated score alone.
7. Record any separately authorized live provider check with its configuration and observed result. Fixture success does not prove account access or live image quality.
8. For a public release, verify ownership, abuse limits, spending reservations, ambiguous timeout behavior, retention, and restart recovery.
9. For deployment, verify the confirmed hardware, immutable image digest, health checks, backup restore, and rollback evidence before routing the subdomain.
10. Publish a reviewable phase commit and release notes that distinguish completed work from the next planned phase.
