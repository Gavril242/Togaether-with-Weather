import { z } from "zod";
import { locationIdSchema } from "@/domain/locations";

export const PLACES_COOKIE = "fourcast_places_v1";
export const PLACES_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
export const placeIdsSchema = z.array(locationIdSchema).max(4).refine((ids) => new Set(ids).size === ids.length);
export const placeIdsQuerySchema = z.string().max(43).regex(/^[1-9]\d{0,9}(?:,[1-9]\d{0,9}){0,3}$/)
  .transform((value) => value.split(",").map(Number)).pipe(placeIdsSchema);

/** Only a version and canonical IDs belong in the preference cookie. */
export function encodePlaceCookie(ids: number[]): string {
  return ["1", ...placeIdsSchema.parse(ids)].join(".");
}

export function decodePlaceCookie(value: string): number[] | null {
  if (value.length > 45 || !/^1(?:\.[1-9]\d{0,9}){0,4}$/.test(value)) return null;
  const parsed = placeIdsSchema.safeParse(value.split(".").slice(1).map(Number));
  return parsed.success ? parsed.data : null;
}

export function readPlaceCookie(cookieHeader: string): { present: boolean; ids: number[] | null } {
  const matching = cookieHeader.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${PLACES_COOKIE}=`));
  if (matching.length === 0) return { present: false, ids: null };
  // Ambiguous cookies can come from old paths. Never pick a different selection
  // depending on browser cookie ordering.
  if (matching.length !== 1) return { present: true, ids: null };
  return { present: true, ids: decodePlaceCookie(matching[0].slice(PLACES_COOKIE.length + 1)) };
}

export function placeCookieHeader(ids: number[], secure: boolean): string {
  return `${PLACES_COOKIE}=${encodePlaceCookie(ids)}; Path=/; Max-Age=${PLACES_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
