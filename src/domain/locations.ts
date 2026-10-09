import { z } from "zod";

export const locationIdSchema = z.number().int().positive().max(2_147_483_647);

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z.string().min(1).max(100).refine(isTimeZone);

export const locationSchema = z.object({
  id: locationIdSchema,
  name: z.string().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: timeZoneSchema,
  country: z.string().min(1).max(200),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  admin1: z.string().max(200).nullable(),
});

export type Location = z.infer<typeof locationSchema>;

export const searchQuerySchema = z.string().trim().min(2).max(100).refine(
  (value) => Array.from(value).every((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127),
  "Enter a place name without control characters.",
);

export const locationIdQuerySchema = z.string().regex(/^[1-9]\d{0,9}$/).transform(Number).pipe(locationIdSchema);

export type LocationsResponse = { locations: Location[] };

export function locationLabel(location: Location): string {
  return [location.name, location.admin1, location.country].filter(Boolean).join(", ");
}
