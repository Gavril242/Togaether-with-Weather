# Working rules

## Scope

Build the weather product described in `docs/DELIVERY_PLAN.md`. This is a separate project. Preserve other repositories and the owner's existing Raspberry Pi projects.

Deployment is deferred until the owner supplies the Cloudflare tunnel details and authorizes that stage. Do not access the Pi, alter existing tunnels, or modify other services during implementation planning.

On 10 October 2026 the owner supplied the tunnel token and authorized the dedicated weather deployment. Only this project's origin, connector, and new monitoring workflow may be installed. Preserve the existing projects, tunnel services, and workflows. Reuse the store's mail configuration by reference or in a separate credential; do not modify the store.

## Engineering

Use thin route handlers and separate location, weather, prompt, provider, jobs, storage, and operations modules. Keep secrets in server configuration. Never invent weather data or report deployment, security, or performance results without evidence.

Each phase must produce usable behavior, focused tests, a truthful README update, and reviewable commits. Use `codex/` for feature branches. Do not rewrite published history to manufacture a development sequence.

Pin dependencies with the npm lockfile and pin GitHub Actions to verified commit SHAs. Run ordinary pull request workflows without paid provider secrets or deployment credentials. Never run public pull request code on the shared Pi.

Make meaningful tests cover user behavior and failure boundaries. Use provider fixtures in CI and reserve live image calls for an explicitly authorized smoke test. Protect job ownership, image costs, and ambiguous provider results.

## Writing

Use plain factual prose and numbered lists or tables. Avoid decorative status badges, unsupported guarantees, artificial metrics, and promotional architecture claims. Keep the submission README short.
