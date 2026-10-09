import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SECURITY_MODELS } from "./security-tracker.mjs";

const source = readFileSync(new URL("./security-tracker.mjs", import.meta.url), "utf8").replace(/^export /gm, "");
const responseOptions = {
  response: { response: { fullResponse: true, neverError: true, responseFormat: "text" } },
  redirect: { redirect: { followRedirects: false } },
};

/** Credentials remain in n8n; this generator accepts only their references. */
export function makeSecurityWorkflow(configuration = {}) {
  const config = {
    repository: "Gavril242/Togaether-with-Weather", model: "gemma-4-26b-a4b-it",
    from: "__RESEND_FROM__", to: "__ALERT_TO__",
    resendCredentialId: "__RESEND_CREDENTIAL_ID__", resendCredentialName: "__RESEND_CREDENTIAL_NAME__",
    geminiCredentialId: "__GEMINI_CREDENTIAL_ID__", geminiCredentialName: "__GEMINI_CREDENTIAL_NAME__",
    ...configuration,
  };
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(config.repository) || !SECURITY_MODELS.includes(config.model)) throw new Error("Unsupported repository or Gemma model configuration");
  const feedUrl = `https://raw.githubusercontent.com/${config.repository}/fourcast-security/latest.json`;
  const lockUrl = `https://raw.githubusercontent.com/${config.repository}/main/package-lock.json`;
  const publicConfig = { repository: config.repository, model: config.model, feedUrl, from: config.from, to: config.to };
  const code = (name, position, jsCode) => ({
    id: name.toLowerCase().replaceAll(" ", "_"), name, type: "n8n-nodes-base.code", typeVersion: 2, position,
    parameters: { mode: "runOnceForAllItems", jsCode: `${source}\n\n${jsCode}` },
  });
  const http = (name, position, parameters, timeout) => ({
    id: name.toLowerCase().replaceAll(" ", "_"), name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position,
    alwaysOutputData: true, onError: "continueRegularOutput", retryOnFail: false,
    parameters: { ...parameters, options: { ...responseOptions, timeout } },
  });
  const condition = (name, position, expression) => ({
    id: name.toLowerCase().replaceAll(" ", "_"), name, type: "n8n-nodes-base.if", typeVersion: 2, position,
    parameters: { conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
      conditions: [{ id: `${name}-condition`, leftValue: expression, rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }],
      combinator: "and",
    }, options: {} },
  });
  const nodes = [
    { id: "schedule", name: "Daily scan and mail retry clock", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0],
      parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 30 }] } } },
    code("Decide daily scan", [240, 0], [
      "const data = $getWorkflowStaticData('global');",
      "const result = securityWake(data.fourcastSecurity ?? null, Date.now());",
      "data.fourcastSecurity = result.state;",
      "return [{ json: { scanDue: result.scanDue, notification: result.notification, needsAttention: result.state.needsAttention, trackingPaused: result.state.trackingPaused } }];",
    ].join("\n")),
    condition("Scan is due", [480, 0], "={{ $json.scanDue }}"),
    http("Read security report", [720, -200], { url: feedUrl }, 15_000),
    http("Read current main lockfile", [960, -200], { url: lockUrl }, 15_000),
    code("Prepare exact lockfile hash", [1200, -200], "return [{ json: securityLockInput($input.first().json) }];"),
    { id: "hash_lockfile", name: "Hash main lockfile", type: "n8n-nodes-base.crypto", typeVersion: 1, position: [1440, -200],
      alwaysOutputData: true, onError: "continueRegularOutput",
      parameters: { action: "hash", type: "SHA256", binaryData: false, value: "={{ $json.lockText }}", dataPropertyName: "currentLockSha256", encoding: "hex" } },
    code("Verify security feed", [1680, -200], [
      `const repository = ${JSON.stringify(config.repository)};`,
      "const current = $input.first().json;",
      "const validation = validateSecurityReport($('Read security report').first().json, current.lockValid ? current.currentLockSha256 : null, Date.now(), repository);",
      "const data = $getWorkflowStaticData('global');",
      "const findings = validation.ok ? newSecurityFindings(data.fourcastSecurity, validation.report) : [];",
      "return [{ json: { validation, findings, summarize: findings.length > 0 } }];",
    ].join("\n")),
    condition("New verified advisories", [1920, -200], "={{ $json.summarize }}"),
    code("Build verified Gemma input", [2160, -300], "return [{ json: { request: buildSecuritySummaryRequest($input.first().json.findings) } }];"),
    { ...http("Summarize with Gemma", [2400, -300], {
      method: "POST", url: `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`,
      authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth",
      sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify($json.request) }}",
    }, 25_000), credentials: { httpHeaderAuth: { id: config.geminiCredentialId, name: config.geminiCredentialName } } },
    code("Prepare security mail", [2640, -200], [
      `const config = ${JSON.stringify(publicConfig)};`,
      "const verified = $('Verify security feed').first().json;",
      "const summary = verified.summarize ? classifySecuritySummary($input.first().json, verified.findings) : { ok: true, reason: 'No new advisory needs a summary', text: null };",
      "const data = $getWorkflowStaticData('global');",
      "const result = prepareSecurityNotification(data.fourcastSecurity, verified.validation, summary, Date.now(), securityIncidentId(), config);",
      "data.fourcastSecurity = result.state;",
      "return [{ json: { notification: result.notification, newFindingRows: verified.findings.length, summaryAvailable: summary.ok, needsAttention: result.state.needsAttention, trackingPaused: result.state.trackingPaused } }];",
    ].join("\n")),
    condition("Security mail is due", [2880, 0], "={{ $json.notification !== null }}"),
    { ...http("Send security email", [3120, -100], {
      method: "POST", url: "https://api.resend.com/emails",
      authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth",
      sendHeaders: true, headerParameters: { parameters: [{ name: "Idempotency-Key", value: "={{ $json.notification.key }}" }] },
      sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify($json.notification.payload) }}",
    }, 15_000), credentials: { httpHeaderAuth: { id: config.resendCredentialId, name: config.resendCredentialName } } },
    code("Record security mail acceptance", [3360, -100], [
      "const data = $getWorkflowStaticData('global');",
      "const notification = $('Security mail is due').first().json.notification;",
      "const previousCount = data.fourcastSecurity.pending.length;",
      "data.fourcastSecurity = acknowledgeSecurityNotification(data.fourcastSecurity, notification.key, $input.first().json, Date.now());",
      "return [{ json: { accepted: data.fourcastSecurity.pending.length < previousCount, needsAttention: data.fourcastSecurity.needsAttention, trackingPaused: data.fourcastSecurity.trackingPaused } }];",
    ].join("\n")),
  ];
  const link = (node, index = 0) => ({ node, type: "main", index });
  return {
    name: "Fourcast verified vulnerability tracker", active: false, nodes,
    connections: {
      "Daily scan and mail retry clock": { main: [[link("Decide daily scan")]] },
      "Decide daily scan": { main: [[link("Scan is due")]] },
      "Scan is due": { main: [[link("Read security report")], [link("Security mail is due")]] },
      "Read security report": { main: [[link("Read current main lockfile")]] },
      "Read current main lockfile": { main: [[link("Prepare exact lockfile hash")]] },
      "Prepare exact lockfile hash": { main: [[link("Hash main lockfile")]] },
      "Hash main lockfile": { main: [[link("Verify security feed")]] },
      "Verify security feed": { main: [[link("New verified advisories")]] },
      "New verified advisories": { main: [[link("Build verified Gemma input")], [link("Prepare security mail")]] },
      "Build verified Gemma input": { main: [[link("Summarize with Gemma")]] },
      "Summarize with Gemma": { main: [[link("Prepare security mail")]] },
      "Prepare security mail": { main: [[link("Security mail is due")]] },
      "Security mail is due": { main: [[link("Send security email")], []] },
      "Send security email": { main: [[link("Record security mail acceptance")]] },
    },
    settings: { timezone: "Europe/Bucharest", executionOrder: "v1", executionTimeout: 120,
      saveDataSuccessExecution: "none", saveDataErrorExecution: "all", saveManualExecutions: false },
    staticData: null,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(new URL("./security-tracker.template.json", import.meta.url), `${JSON.stringify(makeSecurityWorkflow(), null, 2)}\n`);
}
