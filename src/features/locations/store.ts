import { z } from "zod";
import { locationSchema, type Location } from "@/domain/locations";
import { placeCookieHeader, readPlaceCookie, placeIdsSchema } from "./cookie";

export const STORAGE_KEY = "fourcast.locations.v1";
const storedSchema = z.object({ version: z.literal(1), locations: z.array(locationSchema).max(4), cookieSynced: z.boolean().optional() });
export type Selection = { locations: Location[]; storageError: string | null };
export const EMPTY_SELECTION: Selection = { locations: [], storageError: null };

export function restoreSelection(value: string | null): Selection {
  if (!value) return EMPTY_SELECTION;
  try {
    if (value.length > 16_000) throw new Error("Saved preference too large");
    const data = storedSchema.parse(JSON.parse(value));
    if (new Set(data.locations.map(place => place.id)).size !== data.locations.length) throw new Error("Duplicates");
    return { locations: data.locations, storageError: null };
  } catch {
    return { locations: [], storageError: "Saved places could not be restored. Please choose them again." };
  }
}

let current = EMPTY_SELECTION;
let loaded = false;
let revision = 0;
let restoration: AbortController | null = null;
let pendingIds: number[] | null = null;
let migrateCookie = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

function writeCookie(locations: Location[]): boolean {
  try {
    const ids = locations.map((place) => place.id);
    document.cookie = placeCookieHeader(ids, window.location.protocol === "https:");
    return readPlaceCookie(document.cookie).ids?.join(".") === ids.join(".");
  } catch { return false; }
}

function writeLocal(locations: Location[], cookieSynced = true): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, locations, cookieSynced }));
    return true;
  } catch { return false; }
}

function cancelRestoration() {
  revision += 1;
  restoration?.abort();
  restoration = null;
  pendingIds = null;
}

function loadBrowserSelection() {
  let local: Selection;
  let cookieUnsynced = false;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    local = restoreSelection(value);
    if (value && !local.storageError) cookieUnsynced = storedSchema.parse(JSON.parse(value)).cookieSynced === false;
  }
  catch { local = { locations: [], storageError: "Your browser cannot read saved places. Choose them again to keep them in this tab." }; }
  // If an earlier cookie write was blocked, newer local preferences must win
  // over the still-readable old cookie until synchronization succeeds.
  if (cookieUnsynced) { current = local; migrateCookie = true; return; }
  let cookie: ReturnType<typeof readPlaceCookie>;
  try { cookie = readPlaceCookie(document.cookie); }
  catch { current = local; return; }
  if (!cookie.present || !cookie.ids) {
    current = local;
    migrateCookie = local.locations.length > 0;
    if (cookie.present && local.locations.length === 0) {
      current = { ...local, storageError: "Saved place cookie could not be restored. Please choose your places again." };
    }
    return;
  }
  const saved = new Map(local.locations.map((place) => [place.id, place]));
  const locations = cookie.ids.flatMap((id) => saved.has(id) ? [saved.get(id)!] : []);
  current = { locations, storageError: null };
  // A validated matching local record is a quick metadata cache. Every weather
  // request still resolves its ID on the server and fetches actual conditions.
  if (locations.length !== cookie.ids.length) pendingIds = cookie.ids;
}

const restoredSchema = z.object({ locations: z.array(locationSchema).max(4), unavailableIds: placeIdsSchema });

function startRestoration() {
  if (migrateCookie) {
    if (writeCookie(current.locations)) writeLocal(current.locations);
    migrateCookie = false;
  }
  const ids = pendingIds;
  if (!ids || ids.length === 0) return;
  pendingIds = null;
  const initialRevision = revision;
  const controller = new AbortController();
  restoration = controller;
  void (async () => {
    try {
      const response = await fetch(`/api/locations/restore?ids=${ids.join(",")}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
      });
      if (!response.ok) throw new Error("Restore failed");
      const body = restoredSchema.parse(await response.json());
      const returnedIds = [...body.locations.map((place) => place.id), ...body.unavailableIds];
      if (new Set(returnedIds).size !== returnedIds.length || returnedIds.length !== ids.length || returnedIds.some((id) => !ids.includes(id))) {
        throw new Error("Invalid saved location response");
      }
      if (controller.signal.aborted || revision !== initialRevision) return;
      // Another tab can change the shared cookie while localStorage is blocked.
      if (readPlaceCookie(document.cookie).ids?.join(".") !== ids.join(".")) return;
      const canonical = new Map(body.locations.map((place) => [place.id, place]));
      const previous = new Map(current.locations.map((place) => [place.id, place]));
      current = {
        locations: ids.flatMap((id) => canonical.has(id) ? [canonical.get(id)!] : previous.has(id) ? [previous.get(id)!] : []),
        storageError: body.unavailableIds.length > 0 ? "Some saved places could not be restored. Reload to retry, or choose another place." : null,
      };
      writeLocal(current.locations);
      emit();
    } catch {
      if (controller.signal.aborted || revision !== initialRevision) return;
      current = { ...current, storageError: "Saved places could not be restored right now. Reload to retry, or choose them again." };
      emit();
    } finally {
      if (restoration === controller) restoration = null;
    }
  })();
}

export function getSelection(): Selection {
  if (typeof window === "undefined") return EMPTY_SELECTION;
  if (!loaded) {
    loaded = true;
    loadBrowserSelection();
  }
  return current;
}

export function subscribeSelection(listener: () => void) {
  listeners.add(listener);
  getSelection();
  startRestoration();
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      cancelRestoration();
      loadBrowserSelection();
      startRestoration();
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

function save(locations: Location[]) {
  cancelRestoration();
  current = { locations, storageError: null };
  const cookieSaved = writeCookie(locations);
  const localSaved = writeLocal(locations, cookieSaved);
  if (!localSaved && !cookieSaved) current.storageError = "Your browser could not save this change. Your places are available in this tab.";
  emit();
}

export function addLocation(location: Location): string | null {
  const places = getSelection().locations;
  if (places.some(place => place.id === location.id)) return "This place is already on your dashboard.";
  if (places.length === 4) return "Remove a place before adding another.";
  save([...places, locationSchema.parse(location)]);
  return null;
}

export function removeLocation(id: number) { save(getSelection().locations.filter(place => place.id !== id)); }
