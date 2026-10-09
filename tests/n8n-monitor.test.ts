import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeNotification, advanceMonitor, classifyHealth, classifyWeather,
  initialMonitorState, MONITOR_POLICY, monitorIncidentId,
  type MonitorProbe, type MonitorState,
} from "../deploy/n8n/monitor.mjs";
import { makeMonitorWorkflow } from "../deploy/n8n/generate-workflow.mjs";

const start = Date.parse("2026-10-10T06:00:00Z");
const interval = 5 * 60_000;
const id = "55555555-5555-4555-8555-555555555555";
const nextId = "66666666-6666-4666-8666-666666666666";
const config = { origin: "http://127.0.0.1:3102", from: "alerts@example.invalid", to: "owner@example.invalid" };
const bad: MonitorProbe = { ok: false, component: "weather", status: 502, reason: "Weather returned HTTP 502" };
const good: MonitorProbe = { ok: true, component: "weather", status: 200, reason: "Weather is available" };

function openIncident() {
  let state: MonitorState | null = null;
  for (let index = 0; index < 3; index++) {
    state = advanceMonitor(state, bad, start + interval * index, id, config).state;
  }
  return state!;
}

function acceptedIncident() {
  const state = openIncident();
  return acknowledgeNotification(state, state.incident!.outage!.key, { statusCode: 200, body: { id: "fixture-email-id" } }, start + interval * 2);
}

function weatherBody(now = start) {
  return {
    weather: {
      location: { id: 683506 }, units: { temperature: "°C", wind: "km/h" },
      temperatureC: 0, windKmh: 12, highC: 5, lowC: -2,
      observedAt: new Date(now - 5 * 60_000).toISOString(), fetchedAt: new Date(now).toISOString(),
    },
    cache: { status: "fresh", ageSeconds: 0 },
  };
}

afterEach(() => vi.useRealTimers());

describe("monitor probe classification", () => {
  it("accepts n8n 2.15 full text responses under data, including the mail acknowledgement", () => {
    expect(classifyHealth({ statusCode: 200, data: JSON.stringify({ status: "ok", service: "togaether-weather" }) }).ok).toBe(true);
    expect(classifyWeather({ statusCode: 200, data: JSON.stringify(weatherBody()) }, start)).toEqual(good);
    const state = openIncident();
    const accepted = acknowledgeNotification(state, state.incident!.outage!.key, { statusCode: 200, data: JSON.stringify({ id: "fixture-email-id" }) }, start + interval * 2);
    expect(accepted.incident!.outage!.acceptedAt).toBe(start + interval * 2);
  });
  it("distinguishes app liveness from HTTP success with wrong content", () => {
    expect(classifyHealth({ statusCode: 200, body: JSON.stringify({ status: "ok", service: "togaether-weather" }) }).ok).toBe(true);
    expect(classifyHealth({ statusCode: 200, body: "<html>sign in</html>" }).ok).toBe(false);
    expect(classifyHealth({ statusCode: 200, body: { status: "ok", service: "another-app" } }).ok).toBe(false);
    expect(classifyHealth({ error: "request failed with private detail" })).toMatchObject({ ok: false, status: 0, reason: "App connection failed" });
  });

  it("accepts real zero and negative temperatures with fresh weather", () => {
    expect(classifyWeather({ statusCode: 200, body: weatherBody() }, start)).toEqual(good);
  });

  it("classifies stale fallback and warnings as degraded even with HTTP 200", () => {
    const stale = weatherBody();
    stale.cache.status = "stale";
    stale.cache.ageSeconds = 600;
    expect(classifyWeather({ statusCode: 200, body: stale }, start)).toMatchObject({ ok: false, status: 200 });
    expect(classifyWeather({ statusCode: 200, body: { ...weatherBody(), warning: "Cached weather" } }, start).ok).toBe(false);
  });

  it("rejects missing measurements, wrong place or units, and obsolete timestamps", () => {
    const body = weatherBody();
    for (const altered of [
      { ...body, weather: { ...body.weather, windKmh: "12" } },
      { ...body, weather: { ...body.weather, location: { id: 1 } } },
      { ...body, weather: { ...body.weather, units: { temperature: "°F", wind: "mph" } } },
      { ...body, weather: { ...body.weather, observedAt: new Date(start - 151 * 60_000).toISOString() } },
      { ...body, weather: { ...body.weather, observedAt: new Date(start + 16 * 60_000).toISOString() } },
      { ...body, cache: { status: "fresh", ageSeconds: 301 } },
    ]) {
      expect(classifyWeather({ statusCode: 200, body: altered }, start).ok).toBe(false);
    }
  });

  it("keeps upstream and transport private text out of classified state", () => {
    expect(classifyWeather({ statusCode: 429, body: { error: { message: "fixture private detail" } } }, start).reason).toBe("Weather returned HTTP 429");
    expect(classifyWeather({ error: "fixture private authorization" }, start).reason).toBe("Weather connection failed");
  });
});

describe("incident notifications", () => {
  it("requires three consecutive failures and resets a short failure run", () => {
    const one = advanceMonitor(null, bad, start, id, config);
    const two = advanceMonitor(one.state, bad, start + interval, id, config);
    expect(one.notification).toBeNull();
    expect(two.notification).toBeNull();
    const reset = advanceMonitor(two.state, good, start + interval * 2, id, config);
    const again = advanceMonitor(reset.state, bad, start + interval * 3, id, config);
    expect(again.state.failureCount).toBe(1);
    expect(again.state.incident).toBeNull();
    expect(again.notification).toBeNull();
    expect(openIncident().incident!.outage).toMatchObject({ attempts: 1, acceptedAt: null });
  });

  it("sends one outage, stays quiet, and sends recovery after two healthy checks", () => {
    const state = acceptedIncident();
    expect(advanceMonitor(state, bad, start + interval * 3, id, config).notification).toBeNull();
    const recovering = advanceMonitor(state, good, start + interval * 3, id, config);
    expect(recovering.notification).toBeNull();
    const recovered = advanceMonitor(recovering.state, good, start + interval * 4, id, config);
    expect(recovered.notification).toMatchObject({ kind: "recovery", key: `fourcast/${id}/recovery` });
    const acknowledged = acknowledgeNotification(recovered.state, recovered.notification!.key, { statusCode: 201, body: { id: "fixture-recovery-id" } }, start + interval * 4);
    expect(advanceMonitor(acknowledged, good, start + interval * 5, id, config).notification).toBeNull();
  });

  it("reuses identical payload and key after a bounded notification failure cooldown", () => {
    const state = openIncident();
    const original = JSON.stringify(state.incident!.outage!.payload);
    const failed = acknowledgeNotification(state, state.incident!.outage!.key, { statusCode: 500, body: { message: "fixture private detail" } }, start + interval * 2);
    const early = advanceMonitor(failed, { ...bad, reason: "App connection failed" }, start + interval * 2 + 29 * 60_000, id, config);
    expect(early.notification).toBeNull();
    const retry = advanceMonitor(early.state, bad, start + interval * 2 + 30 * 60_000, id, config);
    expect(retry.notification!.key).toBe(`fourcast/${id}/outage`);
    expect(JSON.stringify(retry.notification!.payload)).toBe(original);
    expect(JSON.stringify(retry.state)).not.toContain("fixture private detail");
    expect(retry.state.incident!.outage!.attempts).toBe(2);
  });

  it("does not accept timeouts, 409 conflicts, malformed success, or another incident's response", () => {
    const state = openIncident();
    const key = state.incident!.outage!.key;
    for (const response of [
      { error: "fixture sensitive timeout" },
      { statusCode: 409, body: { name: "invalid_idempotent_request" } },
      { statusCode: 200, body: {} },
      { statusCode: 200, body: "invalid JSON" },
    ]) {
      const result = acknowledgeNotification(state, key, response, start + interval * 2);
      expect(result.incident!.outage!.acceptedAt).toBeNull();
      expect(JSON.stringify(result)).not.toContain("fixture sensitive timeout");
    }
    expect(acknowledgeNotification(state, "another-incident/outage", { statusCode: 200, body: { id: "accepted" } }, start).incident!.outage!.acceptedAt).toBeNull();
  });

  it("never sends a late outage or misleading recovery when the outage mail failed", () => {
    const state = openIncident();
    const first = advanceMonitor(state, good, start + interval * 3, id, config);
    expect(first.notification).toBeNull();
    const second = advanceMonitor(first.state, good, start + interval * 4, id, config);
    expect(second.notification).toBeNull();
    expect(second.state.incident!.outage!.abandonedAt).toBe(start + interval * 4);
    expect(second.state.incident!.recovery).toBeNull();
    expect(advanceMonitor(second.state, good, start + 60 * 60_000, id, config).notification).toBeNull();
  });

  it("pauses pending recovery sends while the service is failing again", () => {
    const one = advanceMonitor(acceptedIncident(), good, start + interval * 3, id, config);
    const two = advanceMonitor(one.state, good, start + interval * 4, id, config);
    const failedAgain = advanceMonitor(two.state, bad, start + 60 * 60_000, nextId, config);
    expect(failedAgain.notification).toBeNull();
  });

  it("uses a new key when another confirmed incident follows recovery", () => {
    let state = acceptedIncident();
    state = advanceMonitor(state, good, start + interval * 3, id, config).state;
    state = advanceMonitor(state, good, start + interval * 4, id, config).state;
    for (let index = 5; index < 8; index++) {
      state = advanceMonitor(state, bad, start + interval * index, nextId, config).state;
    }
    expect(state.incident!.id).toBe(nextId);
    expect(state.incident!.outage!.key).toBe(`fourcast/${nextId}/outage`);
  });

  it("stops retrying before the provider idempotency window expires and bounds attempts", () => {
    const state = openIncident();
    const expired = advanceMonitor(state, bad, start + interval * 2 + MONITOR_POLICY.retryWindowMs, id, config);
    expect(expired.notification).toBeNull();
    expect(expired.state.incident!.outage!.abandonedAt).not.toBeNull();
    let attempts = state;
    for (let index = 1; index <= MONITOR_POLICY.maxNotificationAttempts; index++) {
      attempts = advanceMonitor(attempts, bad, start + interval * 2 + index * MONITOR_POLICY.retryCooldownMs, id, config).state;
    }
    expect(attempts.incident!.outage!.attempts).toBe(MONITOR_POLICY.maxNotificationAttempts);
    expect(attempts.incident!.outage!.abandonedAt).not.toBeNull();
  });

  it("survives JSON restart state without recounting a duplicate or older probe", () => {
    const persisted = JSON.parse(JSON.stringify(acceptedIncident())) as MonitorState;
    expect(advanceMonitor(persisted, bad, persisted.lastCheckedAt!, id, config)).toEqual({ state: persisted, notification: null });
    expect(advanceMonitor(persisted, bad, start - interval, id, config)).toEqual({ state: persisted, notification: null });
    expect(advanceMonitor(persisted, bad, start + 10 * interval, id, config).notification).toBeNull();
    expect(initialMonitorState().incident).toBeNull();
    expect(monitorIncidentId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("generated n8n template", () => {
  it("is inactive, credential free, and handles all HTTP failures without retries", () => {
    const workflow = makeMonitorWorkflow();
    expect(workflow.active).toBe(false);
    expect(workflow.settings).toMatchObject({ timezone: "Europe/Bucharest", executionTimeout: 60 });
    expect(workflow.nodes.some((node) => /gemini|image/i.test(node.name))).toBe(false);
    const http = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
    for (const node of http) {
      expect(node).toMatchObject({ onError: "continueRegularOutput", alwaysOutputData: true, retryOnFail: false });
      expect(node.parameters.options).toMatchObject({ redirect: { redirect: { followRedirects: false } }, response: { response: { fullResponse: true, neverError: true } } });
    }
    expect(http.find((node) => node.name === "Send incident email")!.parameters.url).toBe("https://api.resend.com/emails");
    expect(JSON.stringify(workflow)).toContain("__RESEND_CREDENTIAL_ID__");
    expect(JSON.stringify(workflow)).not.toContain("Bearer re_");
    expect(workflow.connections["App is available"]!.main[1]![0]!.node).toBe("Evaluate incident");
  });

  it("runs the same embedded incident algorithm and saves state on handled failures", () => {
    vi.useFakeTimers();
    const workflow = makeMonitorWorkflow(config);
    const jsCode = workflow.nodes.find((node) => node.name === "Evaluate incident")!.parameters.jsCode as string;
    const execute = new Function("$input", "$", "$getWorkflowStaticData", jsCode) as (
      input: { first: () => { json: unknown } },
      select: (name: string) => { first: () => { json: unknown } },
      staticData: () => Record<string, unknown>,
    ) => Array<{ json: { notification: { kind: string } | null } }>;
    const state: Record<string, unknown> = {};
    let result;
    for (let index = 0; index < 3; index++) {
      vi.setSystemTime(start + index * interval);
      result = execute({ first: () => ({ json: {} }) }, () => ({ first: () => ({ json: { ...bad, component: "app" } }) }), () => state);
    }
    expect(result![0]!.json.notification!.kind).toBe("outage");
    expect(state.fourcastMonitor).toMatchObject({ failureCount: 3, incident: { outage: { attempts: 1 } } });
  });

  it("keeps the committed template generated from the tested source", () => {
    const committed = JSON.parse(readFileSync(new URL("../deploy/n8n/weather-monitor.template.json", import.meta.url), "utf8"));
    expect(committed).toEqual(makeMonitorWorkflow());
  });
});
