# Verified security alerts

This is a separate n8n workflow. It does not modify the weather outage monitor or any existing store workflow. Detection comes from the trusted `main` GitHub scanner workflow, which publishes `fourcast-security/latest.json`. Gemma 4 only summarizes newly verified advisory records.

The feed covers exact production and development versions in the repository lockfile plus a newly built ARM64 runtime image scanned with Trivy. It does not identify the packages currently running on the Pi. Emails retain the scanned commit, lockfile hash, package versions, scopes, severity, reported fixed versions and primary advisory links.

## Install

1. Confirm the public security feed exists and its scanners have completed. The consumer rejects reports older than 48 hours, a different repository or scope, invalid advisory links, and a lockfile hash that differs from the current `main` lockfile. A partial scan produces a coverage warning, including when it reports no findings.
2. Create or reuse the dedicated Resend HTTP Header Auth credential. Its header is `Authorization` and its value is the existing authorized mail API credential in bearer format. Create a separate Gemini HTTP Header Auth credential whose header is `x-goog-api-key`. Enter secrets in n8n credential storage; no secret belongs in the template, source, shell arguments or public feed.
3. Generate a private import JSON with `makeSecurityWorkflow` from `security-generate-workflow.mjs`. Supply `from`, `to`, `resendCredentialId`, `resendCredentialName`, `geminiCredentialId` and `geminiCredentialName`. The default repository is `Gavril242/Togaether-with-Weather` and the default model is `gemma-4-26b-a4b-it`. The only alternative allowed is `gemma-4-31b-it`. Model listing confirms capability, not remaining quota.
4. Import the JSON as a new workflow, verify both credential references, and publish or activate it using the installed n8n version. Preserve existing workflows. The public `security-tracker.template.json` is inactive and contains placeholders. A CLI import or activation may require an n8n restart; avoid interrupting existing services without planning that change.
5. Check a scheduled execution. A verified first report with no findings sends no email. Existing verified findings on the first run send an initial advisory email. Do not repeatedly run the production workflow manually to test it: n8n manual runs do not persist workflow static data and can repeat a notification. Use the fixture tests for repeated verification.

The workflow uses Schedule, Code, Crypto, IF and HTTP Request nodes supported by n8n 2.15.0. Crypto hashes the exact downloaded UTF-8 lockfile text with SHA256; no Code node requires access to Node built-in modules. Report, lockfile, Gemma and Resend requests have fixed HTTPS origins, redirects disabled, finite timeouts and handled HTTP or connection errors. No provider call happens on a normal pull request.

## Delivery behavior

The scheduler wakes every 30 minutes. It reads the report and current lockfile at most once every 24 hours; the additional wakes retry a pending mail request. Gemma receives at most 20 distinct new advisories per daily digest. Every verified affected package row remains in the factual email, including rows beyond the optional summary limit.

An advisory is new when none of its GHSA or CVE aliases was previously accepted for email or is already pending. All package rows for that advisory appear in one digest. Severity or version changes to a known advisory do not create a new alert. Newly learned aliases join the known record, so a GHSA later accompanied by its CVE does not create another email.

The factual email is prepared before Resend is called. Only a 2xx response with an email ID marks it accepted; acceptance does not prove inbox delivery. Failed or uncertain requests retry the exact stored payload and idempotency key after 30 minutes. Retries stop after 12 attempts or 23 hours from the first attempt, before Resend's 24-hour key retention ends. No fresh key is silently created for an uncertain send. The retained pending record has `abandonedAt` and `needsAttention` set, and its advisories remain pending until an operator checks Resend and resolves the state. Later new advisories can still be tracked. Seven retained requests or 50,000 known identifiers pause tracking for operator review rather than silently losing history.

A report failure or incomplete scanner coverage creates one tracker warning while that incident persists. A later complete report clears that incident. Gemma quota, authorization, timeout, refusal, malformed output or unsupported response produces the factual advisory email with one summary warning; it does not discard an advisory. Summaries must use known IDs, have bounded plain text, and contain no new versions, URLs, HTML or shell commands. The model's prose is optional; the linked advisory and scanner records remain the source of facts.

Workflow static data persists after successful scheduled executions. All expected HTTP failures reach a normal end so they can save the pending state. This storage is best effort: a crash between API acceptance and state persistence, overlapping manual execution, a restore of old n8n data, or clearing static data can lose deduplication progress. Provider idempotency reduces duplicates within its retention window; it does not provide permanent exactly-once delivery. Back up n8n's database and encryption key together. This workflow cannot report an outage of its own Pi or n8n instance.

## Verify locally

```powershell
node deploy/n8n/security-generate-workflow.mjs
npm exec vitest run tests/n8n-security.test.ts
```

The tests use synthetic identifiers and mocked responses. They verify report identity and freshness, exact lock hashing, incomplete coverage, alias grouping, factual fallback, immutable retries, uncertain acceptance and the actual embedded Code-node functions. They do not call Gemma, Resend, the Pi or a live vulnerability scanner.

References: [Gemma on the Gemini API](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api), [n8n Crypto](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.crypto/), [n8n workflow static data](https://docs.n8n.io/code/cookbook/builtin/get-workflow-static-data/), [n8n workflow import](https://docs.n8n.io/workflows/export-import/), [n8n CLI](https://docs.n8n.io/hosting/cli-commands/), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
