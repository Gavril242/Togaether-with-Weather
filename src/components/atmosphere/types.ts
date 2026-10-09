export type AtmosphereCondition = "clear" | "cloudy" | "rain" | "snow" | "storm" | "fog";

export interface AtmosphereProps {
  condition?: AtmosphereCondition;
  timezone?: string;
  intensity?: number;
}

export function normalizeIntensity(intensity: number): number {
  return Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0.5;
}
