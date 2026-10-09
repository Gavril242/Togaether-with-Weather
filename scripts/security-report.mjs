import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);
export const REPOSITORY = "Gavril242/Togaether-with-Weather";
export const REPORT_LIMIT = 256 * 1024;
export const TRIVY_VERSION = "0.75.0";
export const TRIVY_IMAGE = "aquasec/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa";
const GHSA = /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/;
const CVE = /^CVE-\d{4}-\d{4,}$/;
const LEVELS = ["critical", "high", "moderate", "medium", "low", "unknown"];
const text = (value, maximum = 240) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maximum) : "";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const severity = (value) => LEVELS.includes(String(value).toLowerCase()) ? String(value).toLowerCase() : "unknown";
const failure = (version, error) => ({ status: "error", version, error });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function boundedJson(path, limit = 20 * 1024 * 1024) {
  const bytes = await readFile(path);
  assert(bytes.byteLength <= limit, "Scanner input exceeds its size limit");
  return JSON.parse(bytes.toString("utf8"));
}

async function npmInstallation() {
  for (const path of [resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js")]) {
    try {
      await access(path);
      const semver = createRequire(path)("semver");
      assert(typeof semver.satisfies === "function", "npm semver is unavailable");
      return { path, semver };
    } catch { /* Try the other official Node installation layout. */ }
  }
  throw new Error("The bundled npm installation could not be located");
}

/** npm audit does not install or repair packages. Every lifecycle script stays disabled. */
async function auditLockfile(root) {
  const installation = await npmInstallation();
  const { stdout: version } = await execute(process.execPath, [installation.path, "--version"]);
  let stdout;
  try {
    ({ stdout } = await execute(process.execPath, [installation.path, "audit", "--json",
      "--package-lock-only", "--ignore-scripts", "--include=dev", "--include=optional",
      "--include=peer", "--registry=https://registry.npmjs.org", "--no-fund"],
    { cwd: root, timeout: 120_000, maxBuffer: 20 * 1024 * 1024 }));
  } catch (error) {
    // Exit 1 is the normal advisory result, not a scanner outage.
    assert(error.code === 1 && typeof error.stdout === "string", "npm audit execution failed");
    stdout = error.stdout;
  }
  const result = JSON.parse(stdout);
  assert(result.auditReportVersion === 2 && !result.error && result.vulnerabilities
    && typeof result.vulnerabilities === "object", "npm audit response is invalid");
  return { result, semver: installation.semver, version: version.trim() };
}

async function advisoryFromGitHub(id) {
  // Only the fixed primary GitHub API receives this validated advisory identifier.
  assert(GHSA.test(id), "Invalid GHSA identifier");
  const response = await fetch(`https://api.github.com/advisories/${id}`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" },
    signal: AbortSignal.timeout(10_000), redirect: "error",
  });
  assert(response.ok, "Primary GitHub advisory verification failed");
  const body = await response.text();
  assert(Buffer.byteLength(body) <= 256 * 1024, "Primary advisory response exceeds its size limit");
  const advisory = JSON.parse(body);
  assert(advisory.ghsa_id === id && Array.isArray(advisory.vulnerabilities), "Primary advisory response is invalid");
  return advisory;
}

/** Verify advisory identity and affected ranges against exact versions in this lockfile. */
export async function npmFindings(lock, audit, semver, lookup = advisoryFromGitHub) {
  const rows = [];
  const checked = new Map();
  for (const [name, item] of Object.entries(audit.vulnerabilities)) {
    if (!item || !Array.isArray(item.via) || !Array.isArray(item.nodes)) continue;
    for (const via of item.via) {
      if (!via || typeof via !== "object" || via.name !== name) continue;
      const match = typeof via.url === "string" && via.url.match(/^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9-]+)$/);
      assert(match && GHSA.test(match[1]), "npm advisory lacks a primary GHSA reference");
      const id = match[1];
      if (!checked.has(id)) {
        assert(checked.size < 100, "Primary advisory verification limit reached");
        checked.set(id, await lookup(id));
      }
      const advisory = checked.get(id);
      if (advisory.withdrawn_at) continue;
      const affected = advisory.vulnerabilities.filter((value) => value.package?.ecosystem === "npm" && value.package?.name === name);
      assert(affected.length > 0, "Primary advisory package differs from npm audit");
      for (const node of item.nodes) {
        const installed = lock.packages?.[node];
        const expectedName = node.split("node_modules/").at(-1);
        if (!installed || expectedName !== name || typeof installed.version !== "string") continue;
        const applicable = affected.find((value) => typeof value.vulnerable_version_range === "string"
          && semver.satisfies(installed.version, value.vulnerable_version_range, { includePrerelease: true }));
        if (!applicable) continue;
        const aliases = [...new Set((advisory.identifiers ?? []).map((value) => value.value)
          .filter((value) => typeof value === "string" && value !== id && (CVE.test(value) || GHSA.test(value))))];
        rows.push({ id, aliases, title: text(advisory.summary || via.title), severity: severity(advisory.severity || via.severity),
          ecosystem: "npm", package: text(name, 160), installedVersion: text(installed.version, 80),
          fixedVersion: text(typeof applicable.first_patched_version === "string"
            ? applicable.first_patched_version : applicable.first_patched_version?.identifier, 80) || null,
          sourceUrl: `https://github.com/advisories/${id}`,
          dependencyScope: installed.dev === true ? "development" : "production" });
      }
    }
  }
  return rows;
}

/** Trivy supplies the installed OS and bundled runtime package versions from the image. */
export function trivyFindings(result) {
  assert(result && result.SchemaVersion === 2 && Array.isArray(result.Results), "Trivy response is invalid");
  const rows = [];
  for (const target of result.Results) {
    if (!Array.isArray(target.Vulnerabilities)) continue;
    for (const value of target.Vulnerabilities) {
      const id = value.VulnerabilityID;
      assert(typeof id === "string" && (CVE.test(id) || GHSA.test(id)), "Trivy advisory identifier is unsupported");
      assert(typeof value.PkgName === "string" && typeof value.InstalledVersion === "string", "Trivy detected package version is missing");
      const aliases = [...new Set((value.References ?? []).flatMap((reference) => {
        if (typeof reference !== "string") return [];
        const match = reference.match(/(?:advisories\/|vuln\/detail\/)(GHSA-[a-z0-9-]+|CVE-\d{4}-\d{4,})(?:$|[?#])/);
        return match && match[1] !== id && (CVE.test(match[1]) || GHSA.test(match[1])) ? [match[1]] : [];
      }))];
      rows.push({ id, aliases, title: text(value.Title || id), severity: severity(value.Severity),
        ecosystem: ["node-pkg", "npm"].includes(target.Type) ? "npm"
          : text(target.Type || (target.Class === "os-pkgs" ? "os" : "library"), 80),
        package: text(value.PkgName, 160), installedVersion: text(value.InstalledVersion, 80),
        fixedVersion: text(value.FixedVersion, 160) || null,
        sourceUrl: GHSA.test(id) ? `https://github.com/advisories/${id}` : `https://nvd.nist.gov/vuln/detail/${id}`,
        dependencyScope: "container" });
    }
  }
  return rows;
}

export function finishReport(report) {
  const unique = new Map();
  for (const row of report.vulnerabilities) {
    const key = `${row.id}\0${row.package}\0${row.installedVersion}\0${row.dependencyScope}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  const all = [...unique.values()].sort((left, right) => LEVELS.indexOf(left.severity) - LEVELS.indexOf(right.severity)
    || left.id.localeCompare(right.id) || left.package.localeCompare(right.package));
  report.vulnerabilities = all.slice(0, 400);
  report.truncated = all.length > report.vulnerabilities.length;
  if (report.truncated) report.scanners.trivy = failure(report.scanners.trivy.version, "Report row limit reached; findings are incomplete");
  report.summary = {
    scanComplete: Object.values(report.scanners).every((scanner) => scanner.status === "ok") && !report.truncated,
    knownVulnerabilityRows: all.length,
    severityCounts: Object.fromEntries(LEVELS.map((level) => [level, all.filter((row) => row.severity === level).length])),
  };
  if (!report.summary.scanComplete) report.summary.knownVulnerabilityRows = null;
  // A size overflow is also explicitly incomplete; never silently publish a healthy result.
  while (Buffer.byteLength(JSON.stringify(report)) > REPORT_LIMIT && report.vulnerabilities.length) {
    report.vulnerabilities.pop();
    report.truncated = true;
    report.summary.scanComplete = false;
    report.summary.knownVulnerabilityRows = null;
    report.scanners.trivy = failure(report.scanners.trivy.version, "Report byte limit reached; findings are incomplete");
  }
  assert(Buffer.byteLength(JSON.stringify(report)) <= REPORT_LIMIT, "Report metadata exceeds its size limit");
  return report;
}

export async function collectReport(directory) {
  assert(process.env.GITHUB_REPOSITORY === REPOSITORY && process.env.GITHUB_REF === "refs/heads/main",
    "Security collection is restricted to the trusted main repository");
  const commit = process.env.GITHUB_SHA;
  assert(/^[0-9a-f]{40}$/.test(commit ?? ""), "Source commit is invalid");
  const root = process.cwd();
  const lockBytes = await readFile(resolve(root, "package-lock.json"));
  const lock = JSON.parse(lockBytes.toString("utf8"));
  assert(lock.lockfileVersion === 3 && lock.packages, "The exact npm lockfile is required");
  const report = { schemaVersion: 1, repository: REPOSITORY, sourceCommit: commit,
    lockSha256: sha256(lockBytes), generatedAt: new Date().toISOString(), scope: "repositoryMain",
    workflowRunId: text(process.env.GITHUB_RUN_ID, 40),
    scanners: { npm: failure(null, "npm scan did not complete"), trivy: failure(TRIVY_VERSION, "Container scan did not complete") },
    vulnerabilities: [],
  };
  try {
    const { result, semver, version } = await auditLockfile(root);
    assert(sha256(await readFile(resolve(root, "package-lock.json"))) === report.lockSha256, "Audit changed the lockfile");
    report.vulnerabilities.push(...await npmFindings(lock, result, semver));
    report.scanners.npm = { status: "ok", version, scope: "productionAndDevelopmentLockfile" };
  } catch {
    // Do not copy subprocess output or provider text into the public report.
    report.scanners.npm = failure(null, "npm audit or primary advisory verification failed; coverage is incomplete");
  }
  try {
    assert(process.env.IMAGE_BUILD_OUTCOME === "success" && process.env.TRIVY_SCAN_OUTCOME === "success", "Container scan did not run successfully");
    const version = await readFile(resolve(directory, "trivy-version.txt"), "utf8");
    assert(version.includes(`Version: ${TRIVY_VERSION}`), "Scanner version differs from its pin");
    const image = (await boundedJson(resolve(directory, "image-inspect.json")))[0];
    assert(image?.Os === "linux" && image?.Architecture === "arm64" && /^sha256:[0-9a-f]{64}$/.test(image.Id ?? ""), "Scanned image identity is invalid");
    assert(image.Config?.Labels?.["org.opencontainers.image.revision"] === commit
      && image.Config?.Labels?.["org.opencontainers.image.source"] === `https://github.com/${REPOSITORY}`, "Scanned image source differs");
    const result = await boundedJson(resolve(directory, "trivy.json"));
    assert(result.Metadata?.ImageID === image.Id, "Trivy report belongs to another image");
    report.vulnerabilities.push(...trivyFindings(result));
    report.image = { imageId: image.Id, platform: "linux/arm64", sourceCommit: commit, scannerImage: TRIVY_IMAGE,
      purpose: "Fresh main runtime build; not a deployed Pi inventory" };
    report.scanners.trivy = { status: "ok", version: TRIVY_VERSION, scope: "containerOperatingSystemAndRuntimeLibraries" };
  } catch {
    report.scanners.trivy = failure(TRIVY_VERSION, "ARM64 image build or Trivy scan verification failed; coverage is incomplete");
  }
  const completed = finishReport(report);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "latest.json"), `${JSON.stringify(completed)}\n`);
  return completed;
}

export function validatePublicReport(report, commit, lockHash) {
  assert(report?.schemaVersion === 1 && report.repository === REPOSITORY && report.scope === "repositoryMain", "Unexpected public report scope");
  const keys = ["schemaVersion", "repository", "sourceCommit", "lockSha256", "generatedAt", "scope",
    "workflowRunId", "scanners", "vulnerabilities", "image", "truncated", "summary"];
  assert(Object.keys(report).every((key) => keys.includes(key)), "Unexpected public metadata field");
  assert(report.sourceCommit === commit && /^[0-9a-f]{40}$/.test(commit), "Public report source differs");
  assert(report.lockSha256 === lockHash && /^[0-9a-f]{64}$/.test(lockHash), "Public report lockfile differs");
  assert(Number.isFinite(Date.parse(report.generatedAt)) && Math.abs(Date.now() - Date.parse(report.generatedAt)) < 60 * 60_000, "Public report timestamp is invalid");
  assert(report.scanners && ["npm", "trivy"].every((key) => ["ok", "error"].includes(report.scanners[key]?.status)), "Public scanner status is invalid");
  assert(Object.keys(report.scanners).length === 2, "Unexpected public scanner");
  for (const scanner of Object.values(report.scanners)) {
    assert(Object.keys(scanner).every((key) => ["status", "version", "scope", "error"].includes(key)), "Unexpected public scanner field");
    assert(scanner.version === null || typeof scanner.version === "string" && scanner.version.length <= 80, "Invalid public scanner version");
    if (scanner.status === "error") assert(typeof scanner.error === "string" && scanner.error.length <= 300, "Public scanner error is missing");
  }
  assert(typeof report.truncated === "boolean" && typeof report.summary?.scanComplete === "boolean", "Public coverage summary is invalid");
  assert(Object.keys(report.summary).every((key) => ["scanComplete", "knownVulnerabilityRows", "severityCounts"].includes(key)), "Unexpected public coverage field");
  assert(report.summary.severityCounts && Object.keys(report.summary.severityCounts).length === LEVELS.length
    && LEVELS.every((key) => Number.isSafeInteger(report.summary.severityCounts[key]) && report.summary.severityCounts[key] >= 0), "Invalid public severity counts");
  if (report.image) {
    assert(Object.keys(report.image).every((key) => ["imageId", "platform", "sourceCommit", "scannerImage", "purpose"].includes(key))
      && /^sha256:[0-9a-f]{64}$/.test(report.image.imageId ?? "") && report.image.platform === "linux/arm64"
      && report.image.sourceCommit === commit && report.image.scannerImage === TRIVY_IMAGE
      && report.image.purpose === "Fresh main runtime build; not a deployed Pi inventory", "Invalid public image scope");
  }
  if (Object.values(report.scanners).some((scanner) => scanner.status === "error") || report.truncated) {
    assert(report.summary.scanComplete === false && report.summary.knownVulnerabilityRows === null, "Incomplete scan must remain explicit");
  }
  assert(Array.isArray(report.vulnerabilities) && report.vulnerabilities.length <= 400, "Public findings exceed their limit");
  for (const row of report.vulnerabilities) {
    assert(Object.keys(row).every((key) => ["id", "aliases", "title", "severity", "ecosystem", "package",
      "installedVersion", "fixedVersion", "sourceUrl", "dependencyScope"].includes(key)), "Unexpected public finding field");
    assert((GHSA.test(row.id) || CVE.test(row.id)) && Array.isArray(row.aliases)
      && row.aliases.length <= 16 && row.aliases.every((id) => GHSA.test(id) || CVE.test(id)), "Invalid public advisory identifier");
    const expectedUrl = GHSA.test(row.id) ? `https://github.com/advisories/${row.id}` : `https://nvd.nist.gov/vuln/detail/${row.id}`;
    assert(row.sourceUrl === expectedUrl && LEVELS.includes(row.severity)
      && typeof row.package === "string" && row.package.length > 0 && row.package.length <= 160
      && typeof row.installedVersion === "string" && row.installedVersion.length > 0 && row.installedVersion.length <= 80
      && typeof row.title === "string" && row.title.length <= 240
      && typeof row.ecosystem === "string" && row.ecosystem.length <= 80
      && (row.fixedVersion === null || typeof row.fixedVersion === "string" && row.fixedVersion.length <= 160)
      && ["production", "development", "container"].includes(row.dependencyScope), "Invalid public advisory fields");
  }
  assert(Buffer.byteLength(JSON.stringify(report)) <= REPORT_LIMIT, "Public report exceeds its size limit");
  return report;
}

/** Append one report commit on a dedicated branch. Tokens stay in process memory. */
export async function publishReport(path) {
  assert(process.env.GITHUB_REPOSITORY === REPOSITORY && process.env.GITHUB_REF === "refs/heads/main"
    && ["schedule", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME), "Only the trusted main reporting workflow may publish");
  const token = process.env.GITHUB_TOKEN;
  assert(typeof token === "string" && token.length > 0, "Publishing token is unavailable");
  const report = validatePublicReport(await boundedJson(path, REPORT_LIMIT), process.env.GITHUB_SHA,
    sha256(await readFile("package-lock.json")));
  const content = `${JSON.stringify(report)}\n`;
  assert(Buffer.byteLength(content) <= REPORT_LIMIT, "Public report exceeds its size limit");
  const endpoint = `https://api.github.com/repos/${REPOSITORY}`;
  async function api(method, route, body, allowMissing = false) {
    const response = await fetch(endpoint + route, { method, redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
        "Content-Type": "application/json", "X-GitHub-Api-Version": "2026-03-10" },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (allowMissing && response.status === 404) return null;
    assert(response.ok, `Report publication API failed with HTTP ${response.status}`);
    return response.json();
  }
  const main = await api("GET", "/git/ref/heads/main");
  assert(main.object?.sha === report.sourceCommit, "Main changed during scanning; rerun the report");
  const reference = await api("GET", "/git/ref/heads/fourcast-security", undefined, true);
  const message = `Security report for ${report.sourceCommit.slice(0, 12)}`;
  if (!reference) {
    // A root commit contains only latest.json. No application source or workflow is copied.
    const blob = await api("POST", "/git/blobs", { content: Buffer.from(content).toString("base64"), encoding: "base64" });
    const tree = await api("POST", "/git/trees", { tree: [{ path: "latest.json", mode: "100644", type: "blob", sha: blob.sha }] });
    const commit = await api("POST", "/git/commits", { message, tree: tree.sha, parents: [] });
    await api("POST", "/git/refs", { ref: "refs/heads/fourcast-security", sha: commit.sha });
  } else {
    const existing = await api("GET", "/contents/latest.json?ref=fourcast-security", undefined, true);
    await api("PUT", "/contents/latest.json", { message, branch: "fourcast-security",
      content: Buffer.from(content).toString("base64"), ...(existing ? { sha: existing.sha } : {}) });
  }
  console.log("Published the bounded Fourcast security report.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === "collect" && process.argv[3]) await collectReport(resolve(process.argv[3]));
    else if (process.argv[2] === "publish" && process.argv[3]) await publishReport(resolve(process.argv[3]));
    else throw new Error("Usage: security-report.mjs collect DIRECTORY | publish REPORT_JSON");
  } catch (error) {
    console.error(text(error.message, 300));
    process.exitCode = 1;
  }
}
