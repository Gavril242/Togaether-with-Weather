# Development record

## Planning, 9 October 2026

Tool: Codex with parallel code review agents and official documentation lookup.

Input: the weather assignment, the existing recruitment project, the owner's infrastructure preferences, and the constraint that deployment to a shared Raspberry Pi 4 with 4 GB RAM happens later.

Output: a repository audit, phased delivery plan, architecture decisions, and verification strategy.

Review: local unit tests, TypeScript, production build, dependency audit, lint behavior, workflows, and Docker availability were checked in the original project. Results are recorded in the private local audit; they do not count as weather product verification.

Changes and exclusions: preserve the old project in a separate checkout; carry over no executable recruitment or sandbox routes; remove unsupported performance and deployment assertions from the new product. Choose a durable worker and spending controls for public image generation. Defer Redis, XFetch, and remote object storage until their adoption criteria are met.

Documentation tooling review: the initial Markdown CLI brought known vulnerable glob and configuration parser dependencies. Replace it with the library API and a small filesystem walker. Pin its math renderer dependency to the advisory's patched KaTeX 0.18.2 release. Keep the audit gate enabled; do not suppress these findings. [KaTeX advisory](https://github.com/advisories/GHSA-238p-pmpm-9mq7)

## Weather foundation and provider boundary, 9 October 2026

Tools: Codex, parallel implementation and review agents, npm registry and official documentation, Vitest, ESLint, TypeScript, Playwright, GitHub Actions, and one authorized Gemini HTTP probe.

Input: the assignment, the delivery plan, React Bits and Three.js references, the owner's Gemini configuration, and the instruction to preserve existing services. The root agent built the dashboard, storage integration, styles, runtime tooling, and CI. Bounded agents implemented weather normalization and caching, the deterministic prompt and Gemini adapter, and the atmospheric shader. Further reviews checked server trust boundaries, accessible controls, lifecycle, and public documentation.

Changed after review: restrict upstream missing location classification to canonical location lookup; clear removed card snapshots so old conditions cannot drive a replacement; prevent hidden keyboard result selection; restore focus after removing a card; include visible words in control names; self host fonts; isolate browser tests from the owner's existing port 3000 application. Fix mobile spacing where desktop line breaks disappear. Explicitly scope bundling and file tracing to the new project after nested fresh checkout verification exposed parent lockfile discovery. Replace unsupported ESLint dependencies with compatible current packages and resolve their advisory tree instead of suppressing audit checks.

Rejected or deferred: the reference's large cloud volume and long raymarch were too costly for an optional background; use a bounded original shader and static fallback. Do not treat a text quota or model listing as image access. Do not fabricate a generated image, enable paid requests before durable accounting, or claim deployment, accessibility scores, or device performance from fixtures. Redis, S3, n8n, containers, and tunnel changes remain future work.

Verification: 75 unit and route tests, production desktop and mobile user flows, strict types, code and Markdown lint, production build, and zero known dependency advisories at check time. The software renderer harness exercised all six atmosphere conditions, pause, disposal, and context recovery. One image request returned quota HTTP 429 and was not retried. No live image output was available to inspect. Final delivery notes link the exact GitHub commit and workflow result.

## Further implementation record format

For each completed phase, add the tools used, the bounded task handed to them, the code changed after human or agent review, the suggestions rejected and why, and the validation actually performed. Record uncertainty rather than claiming that generated code is correct because a tool produced it.
