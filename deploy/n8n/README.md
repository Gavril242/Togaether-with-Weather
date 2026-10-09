# Weather API monitoring

The template creates one separate workflow. It checks app liveness and the canonical Bucharest weather response every five minutes. Three consecutive failed or degraded checks open an incident. Two consecutive successful checks close it. Email is quiet while the incident remains unchanged.

## Install

1. Generate the public template with `node deploy/n8n/generate-workflow.mjs`. Tests import `monitor.mjs`, which is embedded verbatim into the generated Code nodes.
2. Prepare a private copy with the origin reachable from n8n, sender, recipient, and the existing Resend credential's reference ID and name. The example values are placeholders.
3. In n8n, use a dedicated Header Auth credential with header name `Authorization` and value `Bearer` followed by the existing Resend key. The workflow contains only its credential reference. Do not export decrypted credentials or commit filled workflow copies.
4. Import the single new workflow with no workflow ID. Keep it inactive until its target, mail credential, and failure handling have been tested. Never import over another workflow or change unrelated workflows.
5. Publish or activate only this workflow after verification. With Server CLI imports, use `n8n import:workflow --input=one-new-file.json`; API creation uses `POST /api/v1/workflows` with the name, nodes, connections, and settings fields. Activation and publishing commands differ by n8n version, so check the installed version. CLI activation may require a shared service restart; API or UI activation avoids that extra change. [n8n import guidance](https://docs.n8n.io/hosting/cli-commands/), [workflow API](https://docs.n8n.io/connect/n8n-api/workflow).

Node versions target n8n 2.15.0: Schedule Trigger 1.2, HTTP Request 4.2, Code 2, and If 2. The pure tests verify the generated code and connections; importing and running on that actual n8n version remains a separate verification step.

## Checks and notifications

`/api/health` remains a cheap liveness check. When it fails, the weather request is skipped and one app incident is tracked. When it succeeds, `/api/weather?locationId=683506` checks the existing API, units, measurements, observation time, and cache state. A successful HTTP response serving stale weather still counts as degraded. The workflow never submits an image generation request.

The HTTP nodes reject redirects, retain TLS verification, have fixed deadlines, and route HTTP and connection errors into the incident logic. They do not retry inside a run. The whole workflow has a 60 second timeout against a five minute schedule. [HTTP Request options](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/).

Notification requests go to Resend's fixed email endpoint. Each outage or recovery uses a stable incident UUID and event key. Its exact payload is saved and reused so retries cannot change the email under an existing key. Only a successful HTTP response with an email ID marks the notification accepted; this confirms API acceptance, not inbox delivery.

Failed requests wait at least 30 minutes before another attempt. They stop after 12 attempts or 23 hours from the first attempt, whichever comes first. Resend retains idempotency keys for 24 hours; the shorter retry window avoids repeating an uncertain send after that protection expires. [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

Recovery cancels an outage notification that was never accepted. A recovery email is created only for an accepted outage email. After email failure, no raw response or transport error is saved in incident state. Provider acceptance and delivery are different outcomes.

## Persistence and limitations

Incident state uses this workflow's global static data. All expected HTTP failures continue to a successful workflow completion so n8n can save that state. Static data is experimental, is saved after successful production executions, and is not persisted by manual workflow tests. Run real scheduled checks to verify restart behavior. Unexpected node failures, simultaneous manual executions, or a crash before state is saved can still lose progress. This is best effort deduplication rather than a transactional notification outbox. [n8n static data](https://docs.n8n.io/code/cookbook/builtin/get-workflow-static-data/).

Inspect incident state after abandoned notification attempts. Recovery and new incidents keep only bounded current state. This monitor cannot alert while the Pi or n8n itself is down; an external monitor covers that separate boundary.
