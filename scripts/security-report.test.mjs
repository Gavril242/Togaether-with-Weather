import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { finishReport, npmFindings, publishReport, REPOSITORY, REPORT_LIMIT, trivyFindings, validatePublicReport } from "./security-report.mjs";

const npmPath = [resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
  resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js")].find(existsSync);
assert.ok(npmPath, "The official Node distribution's bundled npm is required");
const semver = createRequire(npmPath)("semver");
const id = "GHSA-2345-6789-cfgh";
const commit = "a".repeat(40);
const lockHash = "b".repeat(64);
const row = { id, aliases: ["CVE-2026-12345"], title: "Fixture advisory", severity: "high", ecosystem: "npm",
  package: "example", installedVersion: "1.0.0", fixedVersion: "2.0.0",
  sourceUrl: `https://github.com/advisories/${id}`, dependencyScope: "production" };
const base = () => ({ schemaVersion: 1, repository: REPOSITORY, sourceCommit: commit, lockSha256: lockHash,
  generatedAt: new Date().toISOString(), scope: "repositoryMain",
  scanners: { npm: { status: "ok", version: "fixture" }, trivy: { status: "ok", version: "fixture" } }, vulnerabilities: [] });

test("primary GHSA range selects the affected locked version and its development scope", async () => {
  const lock = { packages: { "node_modules/example": { version: "2.0.0" },
    "node_modules/tool/node_modules/example": { version: "1.0.0", dev: true } } };
  const audit = { vulnerabilities: { example: { via: [{ name: "example", url: row.sourceUrl }], nodes: Object.keys(lock.packages) } } };
  const advisory = { summary: "Fixture", severity: "high", identifiers: [{ value: "CVE-2026-12345" }],
    vulnerabilities: [{ package: { ecosystem: "npm", name: "example" }, vulnerable_version_range: "<2.0.0", first_patched_version: "2.0.0" }] };
  const findings = await npmFindings(lock, audit, semver, async () => advisory);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].installedVersion, "1.0.0");
  assert.equal(findings[0].dependencyScope, "development");
  assert.equal(findings[0].fixedVersion, "2.0.0");
});

test("primary advisory failure and package mismatch are never treated as zero findings", async () => {
  const audit = { vulnerabilities: { example: { via: [{ name: "example", url: row.sourceUrl }], nodes: ["node_modules/example"] } } };
  await assert.rejects(npmFindings({ packages: {} }, audit, semver, async () => { throw new Error("unavailable"); }));
  await assert.rejects(npmFindings({ packages: {} }, audit, semver, async () => ({ vulnerabilities: [] })), /differs/);
});

test("Trivy rows retain actual installed OS versions and discard descriptions and file paths", () => {
  const findings = trivyFindings({ SchemaVersion: 2, Results: [{ Class: "os-pkgs", Type: "debian", Target: "private path",
    Vulnerabilities: [{ VulnerabilityID: "CVE-2026-12345", PkgName: "libexample", InstalledVersion: "1:2.0-1",
      FixedVersion: "1:2.0-2", Severity: "HIGH", Description: "private detail", References: [row.sourceUrl] }] }] });
  assert.equal(findings[0].installedVersion, "1:2.0-1");
  assert.equal(findings[0].sourceUrl, "https://nvd.nist.gov/vuln/detail/CVE-2026-12345");
  assert.deepEqual(findings[0].aliases, [id]);
  assert.ok(!JSON.stringify(findings).includes("private"));
});

test("Trivy records outside verified advisory identifiers fail closed", () => {
  assert.throws(() => trivyFindings({ SchemaVersion: 2, Results: [{ Vulnerabilities: [{
    VulnerabilityID: "UNKNOWN-2026-1", PkgName: "fixture", InstalledVersion: "1.0.0",
  }] }] }), /Trivy advisory identifier is unsupported: UNKNOWN-2026-1/);
});

test("scanner failure keeps coverage incomplete even when the findings list is empty", () => {
  const report = base();
  report.scanners.trivy = { status: "error", error: "Fixture outage" };
  const result = finishReport(report);
  assert.equal(result.summary.scanComplete, false);
  assert.equal(result.summary.knownVulnerabilityRows, null);
});

test("report caps are explicit incomplete coverage and preserve highest severity rows", () => {
  const report = base();
  report.vulnerabilities = Array.from({ length: 500 }, (_, index) => ({ ...row, package: `example-${index}` }));
  const result = finishReport(report);
  assert.equal(result.truncated, true);
  assert.equal(result.vulnerabilities.length, 400);
  assert.equal(result.summary.scanComplete, false);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= REPORT_LIMIT);
});

test("publication rejects mismatched commits, lockfiles and nonprimary source URLs", () => {
  const report = finishReport({ ...base(), vulnerabilities: [row] });
  assert.equal(validatePublicReport(report, commit, lockHash), report);
  assert.throws(() => validatePublicReport(report, "c".repeat(40), lockHash), /source differs/);
  assert.throws(() => validatePublicReport(report, commit, "c".repeat(64)), /lockfile differs/);
  assert.throws(() => validatePublicReport({ ...report, vulnerabilities: [{ ...row, sourceUrl: "https://example.com" }] }, commit, lockHash), /fields/);
  assert.throws(() => validatePublicReport({ ...report, privateMetadata: "fixture" }, commit, lockHash), /metadata field/);
});

test("publication creates a report-only root branch, then appends without rewriting history", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "fourcast-security-test-"));
  const path = resolve(directory, "latest.json");
  const currentLockHash = createHash("sha256").update(await readFile("package-lock.json")).digest("hex");
  await writeFile(path, JSON.stringify(finishReport({ ...base(), lockSha256: currentLockHash })));
  const saved = Object.fromEntries(["GITHUB_REPOSITORY", "GITHUB_REF", "GITHUB_EVENT_NAME", "GITHUB_SHA", "GITHUB_TOKEN"]
    .map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, { GITHUB_REPOSITORY: REPOSITORY, GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_SHA: commit, GITHUB_TOKEN: "fixture-token" });
  try {
    for (const existingBranch of [false, true]) {
      const calls = [];
      globalThis.fetch = async (url, options) => {
        const route = url.replace(`https://api.github.com/repos/${REPOSITORY}`, "");
        const body = options.body ? JSON.parse(options.body) : undefined;
        calls.push({ route, method: options.method, body });
        assert.equal(options.headers.Authorization, "Bearer fixture-token");
        if (route === "/git/ref/heads/main") return { ok: true, json: async () => ({ object: { sha: commit } }) };
        if (route === "/git/ref/heads/fourcast-security" && !existingBranch) return { ok: false, status: 404 };
        return { ok: true, json: async () => ({ sha: "fixture-object" }) };
      };
      await publishReport(path);
      assert.ok(calls.every((call) => !["PATCH", "DELETE"].includes(call.method)));
      if (!existingBranch) {
        assert.deepEqual(calls.find((call) => call.route === "/git/commits").body.parents, []);
        assert.deepEqual(calls.find((call) => call.route === "/git/trees").body.tree.map((entry) => entry.path), ["latest.json"]);
        assert.equal(calls.find((call) => call.route === "/git/refs").body.ref, "refs/heads/fourcast-security");
      } else {
        const update = calls.find((call) => call.method === "PUT");
        assert.equal(update.route, "/contents/latest.json");
        assert.equal(update.body.branch, "fourcast-security");
        assert.equal(update.body.sha, "fixture-object");
        assert.equal(JSON.parse(Buffer.from(update.body.content, "base64")).sourceCommit, commit);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
