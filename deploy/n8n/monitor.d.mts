export type MonitorProbe = { ok: boolean; component: "app" | "weather"; status: number; reason: string };
export type MailConfiguration = { origin: string; from: string; to: string };
export type MailPayload = { from: string; to: string[]; subject: string; text: string };
export type Notification = {
  kind: "outage" | "recovery"; key: string; payload: MailPayload;
  firstAttemptAt: number | null; lastAttemptAt: number | null; attempts: number;
  acceptedAt: number | null; abandonedAt: number | null;
};
export type MonitorIncident = {
  id: string; firstFailureAt: number; confirmedAt: number; closedAt: number | null;
  outage: Notification | null; recovery: Notification | null;
};
export type MonitorState = {
  version: 1; failureCount: number; successCount: number; firstFailureAt: number | null;
  lastCheckedAt: number | null; lastHealthyAt: number | null; lastReason: string | null;
  incident: MonitorIncident | null;
};
export type NotificationRequest = Pick<Notification, "kind" | "key" | "payload">;
export type HttpResult = { statusCode?: number; body?: unknown; data?: unknown; error?: unknown };
export const MONITOR_POLICY: Readonly<{
  failuresBeforeAlert: number; successesBeforeRecovery: number;
  retryCooldownMs: number; retryWindowMs: number; maxNotificationAttempts: number;
}>;
export function jsonBody(response: HttpResult | null): Record<string, unknown> | null;
export function classifyHealth(response: HttpResult | null): MonitorProbe;
export function classifyWeather(response: HttpResult | null, now: number, locationId?: number): MonitorProbe;
export function initialMonitorState(): MonitorState;
export function createNotification(kind: Notification["kind"], incident: MonitorIncident, now: number, config: MailConfiguration, reason: string): Notification;
export function dueNotification(notification: Notification | null, now: number): NotificationRequest | null;
export function advanceMonitor(previous: MonitorState | null, probe: MonitorProbe, now: number, incidentId: string, config: MailConfiguration): { state: MonitorState; notification: NotificationRequest | null };
export function acknowledgeNotification(previous: MonitorState, key: string, response: HttpResult, now: number): MonitorState;
export function monitorIncidentId(): string;
