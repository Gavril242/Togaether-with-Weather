import type { Location } from "./locations";

export type WeatherCategory = "clear" | "cloudy" | "fog" | "rain" | "snow" | "thunderstorm";

export type WeatherSnapshot = {
  location: Location;
  timezone: string;
  observedAt: string;
  fetchedAt: string;
  localDate: string;
  temperatureC: number;
  windKmh: number;
  highC: number;
  lowC: number;
  weatherCode: number;
  condition: string;
  category: WeatherCategory;
  isDay: boolean;
  units: { temperature: "°C"; wind: "km/h" };
};

export type WeatherResponse = {
  weather: WeatherSnapshot;
  cache: { status: "fresh" | "stale"; ageSeconds: number };
  warning?: string;
};

export type ApiErrorResponse = {
  error: { code: string; message: string; retryable: boolean };
};

const conditions: Record<number, { condition: string; category: WeatherCategory }> = {
  0: { condition: "Clear sky", category: "clear" },
  1: { condition: "Mainly clear", category: "clear" },
  2: { condition: "Partly cloudy", category: "cloudy" },
  3: { condition: "Overcast", category: "cloudy" },
  45: { condition: "Fog", category: "fog" },
  48: { condition: "Depositing rime fog", category: "fog" },
  51: { condition: "Light drizzle", category: "rain" },
  53: { condition: "Moderate drizzle", category: "rain" },
  55: { condition: "Dense drizzle", category: "rain" },
  56: { condition: "Light freezing drizzle", category: "rain" },
  57: { condition: "Dense freezing drizzle", category: "rain" },
  61: { condition: "Slight rain", category: "rain" },
  63: { condition: "Moderate rain", category: "rain" },
  65: { condition: "Heavy rain", category: "rain" },
  66: { condition: "Light freezing rain", category: "rain" },
  67: { condition: "Heavy freezing rain", category: "rain" },
  71: { condition: "Slight snowfall", category: "snow" },
  73: { condition: "Moderate snowfall", category: "snow" },
  75: { condition: "Heavy snowfall", category: "snow" },
  77: { condition: "Snow grains", category: "snow" },
  80: { condition: "Slight rain showers", category: "rain" },
  81: { condition: "Moderate rain showers", category: "rain" },
  82: { condition: "Violent rain showers", category: "rain" },
  85: { condition: "Slight snow showers", category: "snow" },
  86: { condition: "Heavy snow showers", category: "snow" },
  95: { condition: "Thunderstorm", category: "thunderstorm" },
  96: { condition: "Thunderstorm with slight hail", category: "thunderstorm" },
  99: { condition: "Thunderstorm with heavy hail", category: "thunderstorm" },
};

export function describeWeather(code: number): { condition: string; category: WeatherCategory } | undefined {
  return conditions[code];
}

export function localDateAt(instant: Date | number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
