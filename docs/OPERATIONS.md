# Weather operations

## Release boundary

The owner authorized a separate weather deployment on 10 October 2026. The target is a Raspberry Pi 4 with 4 GB RAM, Debian 13, and an ARM64 operating system. Existing projects and connectors are outside this release.

The ARM64 workflow uses a GitHub hosted runner. It builds from the pinned official Node 24 image, starts the exact production Compose configuration, checks liveness and bundled browser assets, and exports an image archive with its source commit, image ID, architecture, and SHA256. No image provider key or Pi access is used by CI. Artifacts expire after seven days. Validation branch artifacts are marked ineligible for promotion.

Deploy only an artifact from a successful main workflow whose source commit also passed application checks. Verify its archive hash, load it with Docker, and compare the loaded image ID and architecture to the release manifest. The fixed [promotion script](../scripts/deploy-pi.sh) performs those local checks and refuses a validation branch artifact. The operator first verifies the successful workflow provenance using authenticated GitHub access. Never use `latest`, an unreviewed branch artifact, or a public pull request runner on the Pi.

Place `compose.yaml` and the script in the dedicated project directory. Place the selected artifact's files under its `releases/COMMIT` directory, then run:

```sh
sudo bash /home/YOUR_USER/fourcast/scripts/deploy-pi.sh \
  /home/YOUR_USER/fourcast/releases/FULL_COMMIT \
  FULL_COMMIT /home/YOUR_USER/fourcast
```

Keep the prior release manifest, image, and Compose file for rollback. The script records `current.json`, snapshots the exact Compose configuration, prevents overlapping promotions, and restores the previous managed image if readiness fails. For deliberate rollback, restore the recorded prior Compose file and promote the retained prior verified archive with its commit. Syntax and mocked success, rejection, and rollback paths have passed; a live failed upgrade has not been exercised. The weather origin has no server database or uploaded media in this release; future image jobs will need a separate migration and backup procedure.

## Origin and connector

Compose uses project name `fourcast`. Its origin publishes only `127.0.0.1:3102`, runs as an unprivileged user with a read only filesystem, and has bounded memory, CPU, process count, temporary storage, and logs. Docker health checks test only `/api/health`; a provider outage must not restart the origin.

The dedicated `fourcast-tunnel.service` uses the Pi's existing cloudflared binary. It does not install or replace the shared `cloudflared.service`. The tunnel token resides in a root owned file at `/etc/fourcast/cloudflare.token`, mode 0600. Systemd passes it through `LoadCredential` to the service's dynamic user. No token appears in the unit, repository, image, browser, or process arguments. [Cloudflare token file option](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/cloudflared-parameters/run-parameters/).

The new connector's metrics and readiness bind only to `127.0.0.1:20246`. `/ready` proves an edge connection; separately probe the app and weather. Configure the supplied tunnel's public hostname as HTTP with service URL `http://127.0.0.1:3102`. Cloudflare terminates HTTPS for the public hostname.

The connector was observed with four ready connections on 10 October. The origin rollout and public hostname verification are still pending at this documentation increment.

## API limits

Public weather and saved place routes use bounded in-process token buckets: 30 requests per visitor burst with 60 requests per minute replenishment, plus an origin burst and replenishment of 120 per minute. Counters contain no durable visitor identity and are not logged. Liveness is outside that budget. Caches coalesce matching provider requests and cap stored entries. A shared upstream gate permits eight active requests through complete body processing. Further requests receive a retryable 503 immediately; there is no growing wait queue.

`TRUST_CLOUDFLARE_PROXY=true` is set only by the isolated loopback Compose origin. It accepts a valid `CF-Connecting-IP` from the connector. Do not expose that origin on a LAN interface while trusting caller supplied proxy headers. Local development leaves the setting false. These controls are single process limits, reset on restart, and do not guarantee an upstream daily allowance. Review Open Meteo's public use terms and observe traffic before expanding use.

Paid image generation remains disabled. An image key or tunnel does not bypass the unfinished ownership, durable jobs, and spending controls.

## Monitoring

The new [n8n template](../deploy/n8n/README.md) checks application liveness and a fixed canonical weather location, including stale responses, without calling the paid image model. It reuses the store's Resend configuration in a separate credential. Three consecutive failures trigger one outage email; two healthy checks trigger recovery. Resend idempotency and a bounded retry window prevent blind repeated submissions. Workflow static data provides best effort incident persistence; it is not a transactional outbox. Existing store code, mail settings, and workflows remain unchanged.

Activation requires working n8n management access and a verified origin. A monitor on the same Pi cannot detect its own host losing power; external availability monitoring remains future work.
