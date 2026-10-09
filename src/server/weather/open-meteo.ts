import { z } from "zod";
import { locationSchema, timeZoneSchema, type Location } from "../../domain/locations";
import { describeWeather, localDateAt, type WeatherSnapshot } from "../../domain/weather";
import { invalidProviderResponse, WeatherServiceError } from "./errors";

const providerLocationSchema = z.object({
  id: locationSchema.shape.id,
  name: locationSchema.shape.name,
  latitude: locationSchema.shape.latitude,
  longitude: locationSchema.shape.longitude,
  timezone: timeZoneSchema,
  country: locationSchema.shape.country,
  country_code: locationSchema.shape.countryCode,
  admin1: z.string().max(200).optional(),
});

const searchResponseSchema = z.object({ results: z.array(providerLocationSchema).max(100).optional() });

function normalizeLocation(parsed: z.infer<typeof providerLocationSchema>): Location {
  return {
    id: parsed.id,
    name: parsed.name,
    latitude: parsed.latitude,
    longitude: parsed.longitude,
    timezone: parsed.timezone,
    country: parsed.country,
    countryCode: parsed.country_code,
    admin1: parsed.admin1 || null,
  };
}

export function parseLocations(data: unknown): Location[] {
  const parsed = searchResponseSchema.safeParse(data);
  if (!parsed.success || (typeof data === "object" && data !== null && "error" in data)) {
    throw invalidProviderResponse();
  }
  return (parsed.data.results ?? []).map(normalizeLocation);
}

export function parseLocation(data: unknown, expectedId: number): Location {
  const parsed = providerLocationSchema.safeParse(data);
  if (!parsed.success || parsed.data.id !== expectedId) throw invalidProviderResponse();
  return normalizeLocation(parsed.data);
}

const epochSchema = z.number().int().min(0).max(4_102_444_800);
const temperatureSchema = z.number().min(-120).max(80);

const forecastResponseSchema = z.object({
  timezone: timeZoneSchema,
  utc_offset_seconds: z.number().int().min(-43_200).max(50_400),
  current_units: z.object({
    time: z.literal("unixtime"),
    temperature_2m: z.literal("°C"),
    wind_speed_10m: z.literal("km/h"),
  }),
  current: z.object({
    time: epochSchema,
    temperature_2m: temperatureSchema,
    weather_code: z.number().int().refine((code) => describeWeather(code) !== undefined),
    wind_speed_10m: z.number().min(0).max(500),
    is_day: z.union([z.literal(0), z.literal(1)]),
  }),
  daily_units: z.object({
    time: z.literal("unixtime"),
    temperature_2m_max: z.literal("°C"),
    temperature_2m_min: z.literal("°C"),
  }),
  daily: z.object({
    time: z.array(epochSchema).min(1).max(16),
    temperature_2m_max: z.array(temperatureSchema).min(1).max(16),
    temperature_2m_min: z.array(temperatureSchema).min(1).max(16),
  }).refine((daily) => daily.time.length === daily.temperature_2m_max.length && daily.time.length === daily.temperature_2m_min.length),
});

export function parseForecast(data: unknown, location: Location, now: number): WeatherSnapshot {
  const parsed = forecastResponseSchema.safeParse(data);
  if (!parsed.success) throw invalidProviderResponse();
  const forecast = parsed.data;
  const localDate = localDateAt(now, forecast.timezone);
  // Daily boundaries use Open-Meteo's fixed request-time UTC offset. Using the
  // IANA offset for these boundaries can select the wrong day on a DST change.
  const dailyIndex = forecast.daily.time.findIndex((epoch) =>
    new Date((epoch + forecast.utc_offset_seconds) * 1000).toISOString().slice(0, 10) === localDate,
  );
  const highC = forecast.daily.temperature_2m_max[dailyIndex];
  const lowC = forecast.daily.temperature_2m_min[dailyIndex];
  const condition = describeWeather(forecast.current.weather_code);
  if (highC === undefined || lowC === undefined || highC < lowC || !condition) throw invalidProviderResponse();
  // A successful response must not disguise obsolete current conditions as live.
  const observedTime = forecast.current.time * 1000;
  if (observedTime > now + 15 * 60_000 || now - observedTime > 2 * 60 * 60_000) {
    throw new WeatherServiceError("UPSTREAM_STALE_DATA", "The weather service returned old conditions. Please try again shortly.", 502, true);
  }
  return {
    location,
    timezone: forecast.timezone,
    observedAt: new Date(observedTime).toISOString(),
    fetchedAt: new Date(now).toISOString(),
    localDate,
    temperatureC: forecast.current.temperature_2m,
    windKmh: forecast.current.wind_speed_10m,
    highC,
    lowC,
    weatherCode: forecast.current.weather_code,
    ...condition,
    isDay: forecast.current.is_day === 1,
    units: { temperature: "°C", wind: "km/h" },
  };
}

export function searchUrl(query: string): URL {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({ name: query, count: "8", language: "en", format: "json" }).toString();
  return url;
}

export function locationUrl(id: number): URL {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/get");
  url.search = new URLSearchParams({ id: String(id) }).toString();
  return url;
}

export function forecastUrl(location: Location): URL {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: "temperature_2m,weather_code,wind_speed_10m,is_day",
    daily: "temperature_2m_max,temperature_2m_min",
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    timezone: "auto",
    timeformat: "unixtime",
    forecast_days: "1",
  }).toString();
  return url;
}
