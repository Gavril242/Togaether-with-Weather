import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const monitorSource = readFileSync(new URL("./monitor.mjs", import.meta.url), "utf8").replace(/^export /gm, "");
const resultOptions = {
  response: { response: { fullResponse: true, neverError: true, responseFormat: "text" } },
  redirect: { redirect: { followRedirects: false } },
};

/** Private installs fill these placeholders without placing credentials in JSON. */
export function makeMonitorWorkflow(configuration = {}) {
  const config = {
    origin: "__FOURCAST_ORIGIN__",
    from: "__RESEND_FROM__",
    to: "__ALERT_TO__",
    credentialId: "__RESEND_CREDENTIAL_ID__",
    credentialName: "__RESEND_CREDENTIAL_NAME__",
    ...configuration,
  };
  const code = (name, position, jsCode) => ({
    id: name.toLowerCase().replaceAll(" ", "_"),
    name, type: "n8n-nodes-base.code", typeVersion: 2, position,
    parameters: { mode: "runOnceForAllItems", jsCode: `${monitorSource}\n\n${jsCode}` },
  });
  const http = (name, position, parameters, timeout) => ({
    id: name.toLowerCase().replaceAll(" ", "_"),
    name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position,
    alwaysOutputData: true, onError: "continueRegularOutput", retryOnFail: false,
    parameters: { ...parameters, options: { ...resultOptions, timeout } },
  });
  const condition = (name, position, expression) => ({
    id: name.toLowerCase().replaceAll(" ", "_"), name,
    type: "n8n-nodes-base.if", typeVersion: 2, position,
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
        conditions: [{ id: `${name}-condition`, leftValue: expression, rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
      }, options: {},
    },
  });

  const nodes = [
    { id: "schedule", name: "Every five minutes", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0], parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 5 }] } } },
    http("Check app health", [240, 0], { url: `${config.origin}/api/health` }, 3000),
    code("Validate app health", [480, 0], "return [{ json: classifyHealth($input.first().json) }];"),
    condition("App is available", [720, 0], "={{ $json.ok }}"),
    http("Check Bucharest weather", [960, -100], { url: `${config.origin}/api/weather?locationId=683506` }, 20_000),
    code("Evaluate incident", [1200, 0], [
      `const config = ${JSON.stringify({ origin: config.origin, from: config.from, to: config.to })};`,
      "const health = $('Validate app health').first().json;",
      "const probe = health.ok ? classifyWeather($input.first().json, Date.now()) : health;",
      "const data = $getWorkflowStaticData('global');",
      "const result = advanceMonitor(data.fourcastMonitor ?? null, probe, Date.now(), monitorIncidentId(), config);",
      "data.fourcastMonitor = result.state;",
      "return [{ json: { notification: result.notification, probe, lastCheckedAt: result.state.lastCheckedAt } }];",
    ].join("\n")),
    condition("Notification is due", [1440, 0], "={{ $json.notification !== null }}"),
    {
      ...http("Send incident email", [1680, -100], {
        method: "POST", url: "https://api.resend.com/emails",
        authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth",
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "Idempotency-Key", value: "={{ $json.notification.key }}" }] },
        sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify($json.notification.payload) }}",
      }, 15_000),
      credentials: { httpHeaderAuth: { id: config.credentialId, name: config.credentialName } },
    },
    code("Record email acceptance", [1920, -100], [
      "const data = $getWorkflowStaticData('global');",
      "const notification = $('Evaluate incident').first().json.notification;",
      "data.fourcastMonitor = acknowledgeNotification(data.fourcastMonitor, notification.key, $input.first().json, Date.now());",
      "return [{ json: { incidentId: data.fourcastMonitor.incident?.id, notificationKind: notification.kind, accepted: Boolean(data.fourcastMonitor.incident?.[notification.kind]?.acceptedAt) } }];",
    ].join("\n")),
  ];
  const link = (node, index = 0) => ({ node, type: "main", index });
  return {
    name: "Fourcast weather API monitor",
    active: false,
    nodes,
    connections: {
      "Every five minutes": { main: [[link("Check app health")]] },
      "Check app health": { main: [[link("Validate app health")]] },
      "Validate app health": { main: [[link("App is available")]] },
      "App is available": { main: [[link("Check Bucharest weather")], [link("Evaluate incident")]] },
      "Check Bucharest weather": { main: [[link("Evaluate incident")]] },
      "Evaluate incident": { main: [[link("Notification is due")]] },
      "Notification is due": { main: [[link("Send incident email")], []] },
      "Send incident email": { main: [[link("Record email acceptance")]] },
    },
    settings: {
      timezone: "Europe/Bucharest", executionOrder: "v1", executionTimeout: 60,
      saveDataSuccessExecution: "none", saveDataErrorExecution: "all", saveManualExecutions: false,
    },
    staticData: null,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(new URL("./weather-monitor.template.json", import.meta.url), `${JSON.stringify(makeMonitorWorkflow(), null, 2)}\n`);
}
