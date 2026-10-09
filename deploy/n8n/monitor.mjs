/** Pure incident logic shared by fixture tests and the generated n8n Code nodes. */
export const MONITOR_POLICY = Object.freeze({
  failuresBeforeAlert: 3,
  successesBeforeRecovery: 2,
  retryCooldownMs: 30 * 60_000,
  retryWindowMs: 23 * 60 * 60_000,
  maxNotificationAttempts: 12,
});

export function jsonBody(response) {
  if (!response || typeof response !== "object" || response.error) return null;
  try {
    // HTTP Request 4.2 returns text under `data` on n8n 2.15. JSON format
    // and other supported versions may use `body` instead.
    const raw = Object.hasOwn(response, "body") ? response.body : response.data;
    const body = typeof raw === "string"
      ? raw.length <= 64 * 1024 ? JSON.parse(raw) : null
      : raw;
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export function classifyHealth(response) {
  const status = Number.isInteger(response?.statusCode) ? response.statusCode : 0;
  const body = jsonBody(response);
  const ok = status === 200 && body?.status === "ok" && body?.service === "togaether-weather";
  return {
    ok,
    component: "app",
    status,
    reason: ok ? "App is available" : status === 0 ? "App connection failed" : status !== 200 ? `App returned HTTP ${status}` : "App health response is invalid",
  };
}

export function classifyWeather(response, now, locationId = 683506) {
  const status = Number.isInteger(response?.statusCode) ? response.statusCode : 0;
  const body = jsonBody(response);
  const failed = (reason) => ({ ok: false, component: "weather", status, reason });
  if (status === 0) return failed("Weather connection failed");
  if (status !== 200) return failed(`Weather returned HTTP ${status}`);
  const weather = body?.weather;
  const cache = body?.cache;
  const observed = Date.parse(weather?.observedAt);
  const fetched = Date.parse(weather?.fetchedAt);
  if (
    weather?.location?.id !== locationId ||
    weather?.units?.temperature !== "°C" || weather?.units?.wind !== "km/h" ||
    ![weather?.temperatureC, weather?.windKmh, weather?.highC, weather?.lowC].every((value) => typeof value === "number" && Number.isFinite(value)) ||
    weather.highC < weather.lowC || weather.windKmh < 0 || weather.windKmh > 500 ||
    [weather.temperatureC, weather.highC, weather.lowC].some((value) => value < -120 || value > 80) ||
    !Number.isFinite(observed) || !Number.isFinite(fetched) ||
    observed > now + 15 * 60_000 || now - observed > 150 * 60_000 ||
    fetched > now + 60_000 || now - fetched > 30 * 60_000 ||
    !Number.isFinite(cache?.ageSeconds) || cache.ageSeconds < 0 ||
    !["fresh", "stale"].includes(cache?.status) ||
    (cache.status === "fresh" && cache.ageSeconds >= 300)
  ) return failed("Weather response is invalid or obsolete");
  if (cache.status === "stale" || typeof body.warning === "string") {
    return failed("Weather refresh failed and cached conditions are being served");
  }
  return { ok: true, component: "weather", status, reason: "Weather is available" };
}

export function initialMonitorState() {
  return {
    version: 1, failureCount: 0, successCount: 0, firstFailureAt: null,
    lastCheckedAt: null, lastHealthyAt: null, lastReason: null, incident: null,
  };
}

export function createNotification(kind, incident, now, config, reason) {
  const outage = kind === "outage";
  const payload = {
    from: config.from,
    to: [config.to],
    subject: outage ? "Fourcast weather API needs attention" : "Fourcast weather API recovered",
    text: [
      outage ? "Three consecutive checks failed." : "Two consecutive checks succeeded after an outage.",
      `Dashboard: ${config.origin}`,
      `Incident: ${incident.id}`,
      `First failure: ${new Date(incident.firstFailureAt).toISOString()}`,
      `${outage ? "Confirmed failure" : "Confirmed recovery"}: ${new Date(now).toISOString()}`,
      `Reason: ${reason}`,
      "This monitor checks app health and the Bucharest weather response.",
    ].join("\n"),
  };
  return {
    kind,
    key: `fourcast/${incident.id}/${kind}`,
    payload,
    firstAttemptAt: null,
    lastAttemptAt: null,
    attempts: 0,
    acceptedAt: null,
    abandonedAt: null,
  };
}

export function dueNotification(notification, now) {
  if (!notification || notification.acceptedAt !== null || notification.abandonedAt !== null) return null;
  if (
    notification.attempts >= MONITOR_POLICY.maxNotificationAttempts ||
    (notification.firstAttemptAt !== null && now - notification.firstAttemptAt >= MONITOR_POLICY.retryWindowMs)
  ) {
    notification.abandonedAt = now;
    return null;
  }
  if (notification.lastAttemptAt !== null && now - notification.lastAttemptAt < MONITOR_POLICY.retryCooldownMs) return null;
  notification.firstAttemptAt ??= now;
  notification.lastAttemptAt = now;
  notification.attempts += 1;
  // Both the key and body remain exactly the same throughout all retries.
  return { kind: notification.kind, key: notification.key, payload: notification.payload };
}

export function advanceMonitor(previous, probe, now, incidentId, config) {
  if (!Number.isFinite(now) || typeof probe?.ok !== "boolean") throw new Error("Invalid monitor input");
  const state = previous ? JSON.parse(JSON.stringify(previous)) : initialMonitorState();
  if (state.version !== 1 || !Number.isSafeInteger(state.failureCount) || !Number.isSafeInteger(state.successCount)) {
    throw new Error("Unsupported monitor state; review before resetting");
  }
  if (state.lastCheckedAt !== null && now <= state.lastCheckedAt) return { state, notification: null };
  state.lastCheckedAt = now;
  state.lastReason = probe.reason;

  if (!probe.ok) {
    state.successCount = 0;
    state.failureCount += 1;
    state.firstFailureAt ??= now;
    if (state.failureCount >= MONITOR_POLICY.failuresBeforeAlert && (!state.incident || state.incident.closedAt !== null)) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incidentId)) throw new Error("Invalid incident ID");
      state.incident = {
        id: incidentId, firstFailureAt: state.firstFailureAt, confirmedAt: now,
        closedAt: null, outage: null, recovery: null,
      };
      state.incident.outage = createNotification("outage", state.incident, now, config, probe.reason);
    }
    const notification = state.incident?.closedAt === null ? dueNotification(state.incident.outage, now) : null;
    return { state, notification };
  }

  state.lastHealthyAt = now;
  state.failureCount = 0;
  state.firstFailureAt = null;
  state.successCount += 1;
  if (state.incident?.closedAt === null && state.successCount >= MONITOR_POLICY.successesBeforeRecovery) {
    state.incident.closedAt = now;
    // Do not send an outage email after recovery if its earlier attempts failed.
    if (typeof state.incident.outage?.acceptedAt === "number") {
      state.incident.recovery = createNotification("recovery", state.incident, now, config, "App health and weather are available");
    } else if (state.incident.outage) {
      state.incident.outage.abandonedAt = now;
    }
  }
  const notification = state.incident?.closedAt !== null && state.successCount >= MONITOR_POLICY.successesBeforeRecovery
    ? dueNotification(state.incident?.recovery, now) : null;
  return { state, notification };
}

export function acknowledgeNotification(previous, key, response, now) {
  const state = JSON.parse(JSON.stringify(previous));
  const incident = state.incident;
  const notification = [incident?.outage, incident?.recovery].find((item) => item?.key === key);
  if (!notification || notification.acceptedAt !== null || notification.abandonedAt !== null) return state;
  const body = jsonBody(response);
  if (
    !response?.error && Number.isInteger(response?.statusCode) &&
    response.statusCode >= 200 && response.statusCode < 300 &&
    typeof body?.id === "string" && body.id.length > 0 && body.id.length <= 200
  ) {
    notification.acceptedAt = now;
  }
  // Discard API bodies and transport messages; they may contain private details.
  return state;
}

/** Incident labels do not authorize anything. Prefer the native UUID generator. */
export function monitorIncidentId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === "x" ? value : (value & 3) | 8).toString(16);
  });
}
