export type SecurityHttpResult = { statusCode?: number; body?: unknown; data?: unknown; error?: unknown };
export type SecurityFinding = {
  id: string; aliases: string[]; title: string; severity: string; ecosystem: string;
  package: string; installedVersion: string; fixedVersion: string | null; sourceUrl: string;
  dependencyScope: "production" | "development" | "container";
};
export type SecurityReport = {
  repository: string; scope: "repositoryMain"; sourceCommit: string; lockSha256: string;
  generatedAt: string; scanComplete: boolean; vulnerabilities: SecurityFinding[];
};
export type SecurityValidation = { ok: boolean; reason: string; report: SecurityReport | null };
export type SecuritySummary = { ok: boolean; reason: string; text: string | null };
export type SecurityIssue = { id: string; reason: string; startedAt: number; notified: boolean };
export type SecurityMail = { from: string; to: string[]; subject: string; text: string };
export type SecurityPending = {
  key: string; payload: SecurityMail; advisoryIds: string[]; issueIds: string[];
  firstAttemptAt: number | null; lastAttemptAt: number | null; attempts: number;
  acceptedAt: number | null; abandonedAt: number | null;
};
export type SecurityState = {
  version: 1; lastWakeAt: number | null; lastScanAt: number | null; seenIds: string[];
  pending: SecurityPending[]; feedIssue: SecurityIssue | null; summaryIssue: SecurityIssue | null;
  needsAttention: boolean; trackingPaused: boolean;
};
export type SecurityNotification = { key: string; payload: SecurityMail };
export type SecurityConfiguration = { from: string; to: string; feedUrl: string };
export const SECURITY_POLICY: Readonly<{
  scanIntervalMs: number; reportMaxAgeMs: number; clockSkewMs: number; reportMaxCharacters: number;
  maxFindings: number; maxSeenIds: number; maxPending: number; retryCooldownMs: number;
  retryWindowMs: number; maxNotificationAttempts: number; maxSummaryFindings: number;
}>;
export const SECURITY_MODELS: readonly string[];
export function securityAdvisoryId(value: unknown): string | null;
export function securityLockInput(response: SecurityHttpResult): { lockValid: boolean; lockText: string };
export function validateSecurityReport(response: SecurityHttpResult, currentLockHash: string | null, now: number, repository: string): SecurityValidation;
export function initialSecurityState(): SecurityState;
export function securityWake(previous: SecurityState | null, now: number): { state: SecurityState; scanDue: boolean; notification: SecurityNotification | null };
export function newSecurityFindings(state: SecurityState, report: SecurityReport): SecurityFinding[];
export function buildSecuritySummaryRequest(findings: SecurityFinding[]): {
  systemInstruction: { parts: { text: string }[] }; contents: { role: string; parts: { text: string }[] }[];
  generationConfig: { temperature: number; maxOutputTokens: number; thinkingConfig: { thinkingLevel: string } };
};
export function classifySecuritySummary(response: SecurityHttpResult, findings: SecurityFinding[]): SecuritySummary;
export function prepareSecurityNotification(previous: SecurityState, validation: SecurityValidation, summary: SecuritySummary, now: number, id: string, config: SecurityConfiguration): { state: SecurityState; notification: SecurityNotification | null };
export function acknowledgeSecurityNotification(previous: SecurityState, key: string, response: SecurityHttpResult, now: number): SecurityState;
export function securityIncidentId(): string;
