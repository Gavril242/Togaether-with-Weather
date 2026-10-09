# Development record

## Planning, 9 October 2026

Tool: Codex with parallel code review agents and official documentation lookup.

Input: the weather assignment, the existing recruitment project, the owner's infrastructure preferences, and the constraint that deployment to a shared Raspberry Pi 4 with 4 GB RAM happens later.

Output: a repository audit, phased delivery plan, architecture decisions, and verification strategy.

Review: local unit tests, TypeScript, production build, dependency audit, lint behavior, workflows, and Docker availability were checked in the original project. Results are recorded in the private local audit; they do not count as weather product verification.

Changes and exclusions: preserve the old project in a separate checkout; carry over no executable recruitment or sandbox routes; remove unsupported performance and deployment assertions from the new product. Choose a durable worker and spending controls for public image generation. Defer Redis, XFetch, and remote object storage until their adoption criteria are met.

Documentation tooling review: the initial Markdown CLI brought known vulnerable glob and configuration parser dependencies. Replace it with the library API and a small filesystem walker. Pin its math renderer dependency to the advisory's patched KaTeX 0.18.2 release. Keep the audit gate enabled; do not suppress these findings. [KaTeX advisory](https://github.com/advisories/GHSA-238p-pmpm-9mq7)

## Implementation record format

For each completed phase, add the tools used, the bounded task handed to them, the code changed after human or agent review, the suggestions rejected and why, and the validation actually performed. Record uncertainty rather than claiming that generated code is correct because a tool produced it.
